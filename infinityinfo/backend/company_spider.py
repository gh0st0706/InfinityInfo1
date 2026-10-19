"""Discover real organizations and extract contact evidence from their own websites."""

import asyncio
import base64
import json
import ipaddress
import re
import socket
import sys
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import scrapy
from scrapy.crawler import CrawlerProcess
from scrapy.exceptions import IgnoreRequest
from scrapy.http import HtmlResponse
from scrapy.utils.project import get_project_settings

try:
    import phonenumbers
except ImportError:
    phonenumbers = None


DENY_HOSTS = {
    "apollo.io", "zoominfo.com", "lusha.com", "rocketreach.co", "seamless.ai",
    "lead411.com", "cognism.com", "salesintel.io", "hunter.io", "yellowpages.com",
    "yelp.com", "mapquest.com", "crunchbase.com", "linkedin.com", "facebook.com",
    "instagram.com", "x.com", "twitter.com", "wikipedia.org", "clutch.co", "bbb.org",
    "urbancompany.com", "justdial.com", "nobroker.in", "sulekha.com", "indiamart.com",
    "scribd.com", "slideshare.net", "issuu.com", "docplayer.net", "truedirectory.co",
    "aeroleads.com", "realestateindia.com", "99acres.com", "magicbricks.com",
    "housing.com", "proptiger.com", "commonfloor.com", "realestateindiaonline.com",
}
SEARCH_AND_PORTAL_HOSTS = {
    "google.com", "bing.com", "duckduckgo.com", "yahoo.com", "msn.com",
    "microsoft.com", "youtube.com", "pinterest.com", "reddit.com",
    "merriam-webster.com", "dictionary.cambridge.org", "thefreedictionary.com",
    "vocabulary.com", "britannica.com", "wikihow.com", "realmadrid.com",
    "flipkart.com", "amazon.com", "myntra.com", "ajio.com", "zara.com", "meesho.com",
    "nykaa.com", "imdb.com", "rottentomatoes.com", "f6s.com", "revenuebase.ai",
    "xhamster.com", "xhamster.desi", "xhaccess.com", "pornhub.com", "xvideos.com",
}
SPAM_LEAD_WORDS = re.compile(
    r"\b(email lists?|mailing lists?|buy leads|buy database|lead generation service|prospect lists?|"
    r"contact databases?|business data provider|b2b data provider)\b", re.I,
)
DIRECTORY_WORDS = re.compile(
    r"\b(top\s+\d+|best\s+\d+|list of\s+(?:top\s+)?(?:real estate|companies|builders|developers)|business directories|yellow pages)\b", re.I,
)
BAD_WORDS = SPAM_LEAD_WORDS
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?!png|jpg|jpeg|gif|svg|webp|bmp)[A-Z]{2,}", re.I)
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\d\s()./-]{7,}\d)(?!\w)")
CONTACT_PATH = re.compile(r"contact|about|team|staff|leadership|company|location", re.I)


def clean(value):
    return " ".join((value or "").split())


def decode_bing_url(wrapped):
    if not wrapped or not wrapped.startswith("a1"):
        return ""
    data = wrapped[2:]
    pad = len(data) % 4
    if pad:
        data += "=" * (4 - pad)
    try:
        return base64.urlsafe_b64decode(data.encode("ascii")).decode("utf-8", errors="ignore")
    except (ValueError, UnicodeError):
        return ""


def denied_host(host):
    host = (host or "").lower().rstrip(".")
    return host == "localhost" or any(host == denied or host.endswith("." + denied) for denied in DENY_HOSTS)


def denied_candidate_host(host):
    host = (host or "").lower().rstrip(".")
    if host == "localhost":
        return True
    all_denied = DENY_HOSTS | SEARCH_AND_PORTAL_HOSTS
    return any(host == denied or host.endswith("." + denied) for denied in all_denied)


def allowed_host(host):
    if not host or denied_host(host):
        return False
    host = host.lower().rstrip(".")
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
    except OSError:
        return False
    return bool(addresses) and all(
        ipaddress.ip_address(address.split("%", 1)[0]).is_global for address in addresses
    )


class PublicHostGuard:
    """Reject private and local destinations before Scrapy opens a connection."""

    async def process_request(self, request):
        parsed = urlparse(request.url)
        if parsed.scheme not in {"http", "https"} or not await asyncio.to_thread(allowed_host, parsed.hostname):
            raise IgnoreRequest(f"Blocked non-public host: {parsed.hostname}")


class OrganizationSpider(scrapy.Spider):
    name = "infinityinfo_organizations"
    max_seed_hosts = 120
    max_candidate_pages = 220

    custom_settings = {
        "ROBOTSTXT_OBEY": False,
        "DOWNLOAD_TIMEOUT": 6,
        "CLOSESPIDER_TIMEOUT": 18,
        "DOWNLOAD_MAXSIZE": 2_500_000,
        "DOWNLOAD_WARNSIZE": 1_800_000,
        "CONCURRENT_REQUESTS": 24,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 2,
        "RETRY_ENABLED": True,
        "RETRY_TIMES": 1,
        "REDIRECT_MAX_TIMES": 3,
        "TELNETCONSOLE_ENABLED": False,
        "EXTENSIONS": {"scrapy.extensions.remote_control.RemoteControl": None},
        "USER_AGENT": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "DOWNLOADER_MIDDLEWARES": {__name__ + ".PublicHostGuard": 50},
        "FEED_EXPORT_ENCODING": "utf-8",
    }

    def __init__(self, query="", location="", country="", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.query, self.location, self.country = query, location, country
        self.seen_candidate_urls = set()
        self.candidate_hosts = {}
        self.candidate_page_count = 0

    async def start(self):
        base = " ".join(filter(None, (self.query, self.location, self.country)))
        query_context = " ".join((self.query, self.location)).casefold()
        is_real_estate = any(term in query_context for term in (
            "real estate", "realty", "property developer", "property developers",
            "builder", "builders", "construction", "housing", "plots", "plotted",
        ))
        search_phrases = []
        if is_real_estate:
            places = [self.location] if self.location else []
            if "bangalore" in query_context or "bengaluru" in query_context:
                places.extend(("Bengaluru", "Bangalore", "North Bangalore"))
            places = list(dict.fromkeys(place for place in places if place))
            place = places[0] if places else ""
            search_phrases.extend((
                f"real estate developers {place} official website",
                f"top real estate developers {place} official",
                f"property developers builders {place} company contact",
                f"residential builders {place} official website",
                f"commercial real estate companies {place} official",
                f"plotted development {place} developers",
                f"villa plots developers {place} official website",
                f"builders {place} contact us",
            ))
            for alternate_place in places[1:]:
                search_phrases.append(f"property developers {alternate_place} official website")
                search_phrases.append(f"plotted development {alternate_place} developers")

        search_phrases.extend([
            f"{base} official company website",
            f"{base} companies contact us",
            f"{base} businesses official website",
        ])
        search_phrases = list(dict.fromkeys(clean(terms) for terms in search_phrases))[:16]
        for index, terms in enumerate(search_phrases):
            # Query Bing search
            bing_url = "https://www.bing.com/search?" + urlencode({"q": terms})
            yield scrapy.Request(
                bing_url, callback=self.parse_search, errback=self.search_error,
                headers={"Referer": "https://www.bing.com/"},
                meta={"search_index": index, "search_page": 0, "search_terms": terms, "search_engine": "bing"}, dont_filter=True,
            )
            # Query DuckDuckGo Lite search
            ddg_url = "https://lite.duckduckgo.com/lite/?" + urlencode({"q": terms})
            yield scrapy.Request(
                ddg_url, callback=self.parse_search, errback=self.search_error,
                headers={"Referer": "https://duckduckgo.com/"},
                meta={"search_index": index, "search_page": 0, "search_terms": terms, "search_engine": "ddg"}, dont_filter=True,
            )

    def search_error(self, failure):
        self.logger.warning("Search failed: %s", failure.value)

    def parse_search(self, response):
        if response.status >= 400:
            return

        # If DDG displays an anomaly/captcha challenge or returns 202, fallback to Bing
        if "anomaly-modal" in response.text or response.status == 202:
            search_terms = response.meta.get("search_terms", "")
            if search_terms and not response.meta.get("bing_fallback"):
                bing_url = "https://www.bing.com/search?" + urlencode({"q": search_terms})
                yield scrapy.Request(
                    bing_url, callback=self.parse_search, errback=self.search_error,
                    headers={"Referer": "https://www.bing.com/"},
                    meta={"search_index": response.meta.get("search_index", 0), "search_page": 0, "search_terms": search_terms, "bing_fallback": True, "search_engine": "bing"},
                    dont_filter=True,
                )
            return

        # DDG Lite exposes an explicit next-page form; crawl one additional page
        if response.meta.get("search_page", 0) == 0 and not response.meta.get("search_fallback"):
            next_form = response.css("form.next_form")
            if next_form:
                form_data = {
                    field.attrib["name"]: field.attrib.get("value", "")
                    for field in next_form[0].css("input[name]")
                }
                if form_data.get("vqd"):
                    yield scrapy.FormRequest(
                        url=response.url, formdata=form_data,
                        callback=self.parse_search, errback=self.search_error,
                        headers={"Referer": response.url},
                        meta={
                            "search_index": response.meta.get("search_index", 0),
                            "search_page": 1,
                            "search_terms": response.meta.get("search_terms", ""),
                        },
                        dont_filter=True,
                    )
        candidates = response.css("a.result-link, a.result__a, li.b_algo h2 a, td.result-snippet a")
        if not candidates:
            search_terms = response.meta.get("search_terms", "")
            if search_terms and not response.meta.get("bing_fallback") and response.meta.get("search_engine") != "bing":
                bing_url = "https://www.bing.com/search?" + urlencode({"q": search_terms})
                yield scrapy.Request(
                    bing_url, callback=self.parse_search, errback=self.search_error,
                    headers={"Referer": "https://www.bing.com/"},
                    meta={"search_index": response.meta.get("search_index", 0), "search_page": 0, "search_terms": search_terms, "bing_fallback": True, "search_engine": "bing"},
                    dont_filter=True,
                )
            return
        for link in candidates:
            href = link.attrib.get("href", "")
            parsed = urlparse(urljoin(response.url, href))
            if parsed.hostname and parsed.hostname.endswith("bing.com"):
                wrapped = parse_qs(parsed.query).get("u", [""])[0]
                href = decode_bing_url(wrapped) or href
            elif parsed.hostname and parsed.hostname.endswith("duckduckgo.com"):
                href = parse_qs(parsed.query).get("uddg", [""])[0] or href
            target = urlparse(href)
            if target.scheme not in {"http", "https"} or not target.hostname:
                continue
            host = target.hostname.lower()
            if denied_candidate_host(host):
                continue
            title = clean(" ".join(link.xpath(".//text()").getall()))
            snippet = clean(" ".join(link.xpath("ancestor::div[contains(@class,'result')]//text()").getall() or
                                     link.xpath("ancestor::li//p//text()").getall()))
            if SPAM_LEAD_WORDS.search(title + " " + snippet):
                continue

            # If the search result is an aggregator or directory ("Top 10 builders..."), harvest third-party links!
            if DIRECTORY_WORDS.search(title + " " + snippet):
                yield scrapy.Request(
                    target.geturl(), callback=self.parse_directory_seed,
                    meta={"host": host, "title": title},
                    errback=self.page_error, dont_filter=True,
                )
                continue

            path_key = target.path.rstrip("/") or "/"
            candidate_key = f"{target.scheme}://{host}{path_key}"
            if candidate_key in self.seen_candidate_urls:
                continue
            host_count = self.candidate_hosts.get(host, 0)
            if host_count >= 2 or (host_count and not CONTACT_PATH.search(target.path)):
                continue
            if len(self.candidate_hosts) >= self.max_seed_hosts or self.candidate_page_count >= self.max_candidate_pages:
                continue
            self.seen_candidate_urls.add(candidate_key)
            self.candidate_hosts[host] = host_count + 1
            self.candidate_page_count += 1
            yield scrapy.Request(
                target.geturl(), callback=self.parse_company,
                meta={"host": host, "title": title, "snippet": snippet},
                errback=self.page_error, dont_filter=True,
            )

    def parse_directory_seed(self, response):
        """Extract individual company websites linked from directory and roundup articles."""
        if not isinstance(response, HtmlResponse) or response.status >= 400:
            return
        origin_host = response.meta.get("host", "")
        for href in response.css("a::attr(href)").getall():
            url = urljoin(response.url, href).split("#", 1)[0]
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                continue
            target_host = parsed.hostname.lower()
            if denied_candidate_host(target_host) or target_host == origin_host:
                continue
            path = parsed.path.rstrip("/") or "/"
            if path != "/" and not CONTACT_PATH.search(path):
                continue
            candidate_key = f"{parsed.scheme}://{target_host}{path}"
            if candidate_key in self.seen_candidate_urls:
                continue
            if len(self.candidate_hosts) >= self.max_seed_hosts or self.candidate_page_count >= self.max_candidate_pages:
                break
            self.seen_candidate_urls.add(candidate_key)
            self.candidate_hosts[target_host] = self.candidate_hosts.get(target_host, 0) + 1
            self.candidate_page_count += 1
            yield scrapy.Request(
                candidate_key, callback=self.parse_company,
                meta={"host": target_host, "title": ""},
                errback=self.page_error, dont_filter=True,
            )

    def page_error(self, failure):
        self.logger.debug("Page failed: %s", failure.value)

    def parse_company(self, response):
        if not isinstance(response, HtmlResponse) or response.status >= 400:
            return
        host = response.meta["host"]
        page = self.extract_page(response)
        if SPAM_LEAD_WORDS.search(page["text"][:1800]):
            return
        item = self.make_item(response, page)
        if item:
            yield item
        count = 0
        seen = set()
        for href in page["links"]:
            url = urljoin(response.url, href).split("#", 1)[0]
            parsed = urlparse(url)
            if parsed.hostname != host or not CONTACT_PATH.search(parsed.path) or url in seen:
                continue
            if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
                continue
            seen.add(url)
            yield scrapy.Request(url, callback=self.parse_contact, errback=self.page_error,
                                 meta={"host": host, "root": response.url, "title": item["companyName"] if item else response.meta.get("title", "")})
            count += 1
            if count >= 3:
                break

    def parse_contact(self, response):
        if not isinstance(response, HtmlResponse) or response.status >= 400:
            return
        page = self.extract_page(response)
        if SPAM_LEAD_WORDS.search(page["text"][:1800]):
            return
        item = self.make_item(response, page, response.meta.get("title", ""))
        if item:
            yield item

    def extract_page(self, response):
        text = clean(" ".join(response.xpath("//body//text()[not(ancestor::script or ancestor::style or ancestor::noscript)]").getall()))[:25000]
        emails = {email.lower().rstrip(".,;:") for email in EMAIL_RE.findall(text)}
        emails.update(email.lower() for href in response.css("a[href^='mailto:']::attr(href)").getall()
                      for email in EMAIL_RE.findall(href))
        phones = []
        phones.extend(response.css("a[href^='tel:']::attr(href)").re(r"tel:([^?]+)"))
        if phonenumbers:
            phones.extend(match.raw_string for match in phonenumbers.PhoneNumberMatcher(text, self.phone_region()))
        else:
            phones.extend(PHONE_RE.findall(text))
        phone = ""
        for candidate in phones:
            if phonenumbers:
                try:
                    parsed_phone = phonenumbers.parse(candidate, self.phone_region())
                except phonenumbers.NumberParseException:
                    continue
                if phonenumbers.is_possible_number(parsed_phone):
                    phone = phonenumbers.format_number(parsed_phone, phonenumbers.PhoneNumberFormat.INTERNATIONAL)
                    break
            else:
                digits = re.sub(r"\D", "", candidate)
                if 10 <= len(digits) <= 15:
                    phone = clean(candidate)
                    break
        name = clean(response.css("meta[property='og:site_name']::attr(content)").get() or
                     response.css("meta[name='application-name']::attr(content)").get() or
                     response.css("title::text").get() or response.css("h1::text").get())
        description = clean(response.css("meta[name='description']::attr(content)").get() or
                            response.css("meta[property='og:description']::attr(content)").get())
        address = ""
        address_parts = {"street": "", "city": "", "state": "", "postalCode": "", "country": ""}
        structured_email = set()
        for raw in response.css("script[type='application/ld+json']::text").getall():
            try:
                data = json.loads(raw)
            except (ValueError, TypeError):
                continue
            stack = data if isinstance(data, list) else [data]
            while stack:
                node = stack.pop()
                if isinstance(node, dict):
                    typ = node.get("@type", "")
                    if isinstance(typ, list):
                        typ = " ".join(typ)
                    if any(word in str(typ).lower() for word in ("organization", "localbusiness", "professionalservice", "store")):
                        name = clean(node.get("name") or name)
                        description = clean(node.get("description") or description)
                        if node.get("email"):
                            structured_email.add(str(node["email"]).replace("mailto:", "").lower())
                        phone = clean(node.get("telephone") or phone)
                        addr = node.get("address", {})
                        if isinstance(addr, dict):
                            address_parts = {
                                "street": clean(addr.get("streetAddress", "")),
                                "city": clean(addr.get("addressLocality", "")),
                                "state": clean(addr.get("addressRegion", "")),
                                "postalCode": clean(addr.get("postalCode", "")),
                                "country": clean(addr.get("addressCountry", "") if isinstance(addr.get("addressCountry", ""), str) else addr.get("addressCountry", {}).get("name", "")),
                            }
                            address = clean(", ".join(value for value in address_parts.values() if value))
                    stack.extend(value for value in node.values() if isinstance(value, (dict, list)))
                elif isinstance(node, list):
                    stack.extend(node)
        return {"text": text, "emails": emails | structured_email, "phone": phone, "name": name,
                "description": description, "address": address,
                "address_parts": address_parts, "links": response.css("a::attr(href)").getall()}

    def phone_region(self):
        regions = {
            "india": "IN", "united states": "US", "usa": "US", "united kingdom": "GB",
            "uk": "GB", "canada": "CA", "australia": "AU", "uae": "AE", "united arab emirates": "AE",
            "singapore": "SG", "germany": "DE", "france": "FR", "ireland": "IE",
        }
        return regions.get(self.country.casefold(), None)

    def make_item(self, response, page, fallback_name=""):
        parsed = urlparse(response.meta.get("root", response.url))
        website = f"{parsed.scheme}://{parsed.netloc}"
        email = next((value for value in sorted(page["emails"])
                      if not any(part in value for part in ("example.com", "wixpress.com", "sentry.io"))), "")
        phone = page["phone"]
        company = page["name"] or fallback_name or response.meta.get("title", "")
        company = re.sub(r"^(contact\s+us|about\s+us|home)\s*[|:–—-]\s*", "", company, flags=re.I)
        company = re.sub(r"\s*[|–—-]\s*(home|contact|about|official website|bangalore|bengaluru|real estate).*$", "", company, flags=re.I).strip()
        if company.casefold() in {"contact", "contact us", "about", "about us", "us", "home"}:
            company = fallback_name or response.meta.get("title", "")
        if not company or SPAM_LEAD_WORDS.search(company):
            host_label = parsed.netloc.removeprefix("www.").split(".")[0]
            company = host_label.replace("-", " ").title() if host_label else ""
        if not company or SPAM_LEAD_WORDS.search(company):
            return None
        return {
            "companyName": company[:240], "description": page["description"],
            "address": page["address"], **page["address_parts"], "email": email, "phone": phone,
            "emails": sorted(page["emails"]), "website": website,
            "locationType": "Unverified", "source": "Organization website",
            "sourceUrl": response.url,
            "confidenceScore": 0.85 if page["address"] or email else 0.65 if phone else 0.5,
        }


if __name__ == "__main__":
    if len(sys.argv) < 4:
        raise SystemExit("Usage: company_spider.py QUERY LOCATION COUNTRY")
    query, location, country = sys.argv[1:4]
    settings = get_project_settings()
    settings.set("LOG_LEVEL", "ERROR")
    import os
    output = os.environ.get("INFINITYINFO_SPIDER_OUTPUT")
    if output:
        settings.set("FEEDS", {output: {"format": "json", "overwrite": True}})
    process = CrawlerProcess(settings)
    process.crawl(OrganizationSpider, query=query, location=location, country=country)
    process.start()

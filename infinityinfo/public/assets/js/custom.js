(function ($) {
  "use strict";

  $(function () {
    var $window = $(window);
    var $header = $('.header-area');
    var $menuButton = $('.menu-trigger');
    var $navigation = $('#site-navigation');

    function updateHeader() {
      var bannerHeight = $('.header-text').first().outerHeight() || 0;
      var headerHeight = $header.outerHeight() || 0;
      $header.toggleClass('background-header', $window.scrollTop() >= Math.max(80, bannerHeight - headerHeight));
    }

    $window.on('scroll', updateHeader);
    updateHeader();

    $('.loop').owlCarousel({
      center: true,
      items: 1,
      loop: true,
      autoplay: true,
      nav: true,
      margin: 0,
      responsive: { 760: { items: 2 }, 992: { items: 3 }, 1200: { items: 5 } }
    });

    $menuButton.on('click', function () {
      var expanded = $(this).attr('aria-expanded') === 'true';
      $(this).toggleClass('active', !expanded)
        .attr('aria-expanded', String(!expanded))
        .attr('aria-label', expanded ? 'Open navigation menu' : 'Close navigation menu');
      $navigation.stop(true, true)[expanded ? 'slideUp' : 'slideDown'](180);
    });

    $('.scroll-to-section a[href^="#"]').on('click', function (event) {
      var target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      event.preventDefault();

      if (window.innerWidth <= 991) {
        $menuButton.removeClass('active').attr({
          'aria-expanded': 'false',
          'aria-label': 'Open navigation menu'
        });
        $navigation.stop(true, true).slideUp(160);
      }

      var topOffset = Math.max(0, $(target).offset().top - ($header.outerHeight() || 0));
      $('html, body').stop(true).animate({ scrollTop: topOffset }, 450);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', this.getAttribute('href'));
      }
    });

    function updateActiveLink() {
      var scrollPosition = $window.scrollTop() + ($header.outerHeight() || 0) + 12;
      var activeLink = null;
      $navigation.find('a[href^="#"]').each(function () {
        var target = document.querySelector(this.getAttribute('href'));
        if (target && $(target).offset().top <= scrollPosition) activeLink = this;
      });
      $navigation.find('a').removeClass('active');
      if (activeLink) $(activeLink).addClass('active');
    }

    $window.on('scroll', updateActiveLink);
    updateActiveLink();

    $(document).on('click', '.naccs .menu > div', function () {
      var $tab = $(this);
      if ($tab.hasClass('active')) return;

      var $tabs = $tab.closest('.naccs');
      var index = $tabs.find('.menu > div').index(this);
      var $items = $tabs.find('ul.nacc > li');
      var $selected = $items.eq(index);

      $tabs.find('.menu > div').removeClass('active').attr('aria-pressed', 'false');
      $items.removeClass('active');
      $tab.addClass('active').attr('aria-pressed', 'true');
      $selected.addClass('active');
      $tabs.find('ul.nacc').height($selected.outerHeight(true) + 'px');
    });

    $(document).on('keydown', '.naccs .menu > div[role="button"]', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        $(this).trigger('click');
      }
    });

    $window.on('resize', function () {
      if (window.innerWidth > 991) {
        $menuButton.removeClass('active').attr({
          'aria-expanded': 'false',
          'aria-label': 'Open navigation menu'
        });
        $navigation.stop(true, true).css('display', '');
      }
      var $activeTab = $('.naccs .menu > div.active').first();
      if ($activeTab.length) {
        var $tabs = $activeTab.closest('.naccs');
        var index = $tabs.find('.menu > div').index($activeTab);
        $tabs.find('ul.nacc').height($tabs.find('ul.nacc > li').eq(index).outerHeight(true) + 'px');
      }
    });

    $window.on('load', function () {
      $('#js-preloader').addClass('loaded');
    });
  });
})(window.jQuery);

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const outDir = fileURLToPath(new URL("../../public/assets/phone-checker", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./src/integrated.jsx", import.meta.url)),
      name: "InfinityInfoPhoneChecker",
      formats: ["iife"],
      fileName: () => "phone-checker.iife.js",
      cssFileName: "phone-checker"
    }
  }
});

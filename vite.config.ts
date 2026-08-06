import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    cssCodeSplit: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react-vendor", test: /node_modules[\\/]react(?:-dom|-router-dom)?[\\/]/, priority: 30 },
            { name: "firebase-vendor", test: /node_modules[\\/]@?firebase[\\/]/, priority: 25 },
            { name: "mui-vendor", test: /node_modules[\\/]@(?:mui|emotion)[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
});

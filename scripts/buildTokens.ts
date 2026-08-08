import { buildTokens } from "../src/build/buildTokens.js";

const showDescriptions =
  !process.argv.includes("--no-description") &&
  !process.argv.includes("--no-descriptions");

buildTokens({ showDescriptions })
  .then((result) => {
    console.log("\n🎉 Build completed successfully");
    console.log(`✅ ${result.cssPath}`);
    console.log(`✅ ${result.typographyMixinsPath}`);
    if (result.fluidMixinsPath) {
      console.log(`✅ ${result.fluidMixinsPath}`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("Build failed:", error);
    process.exit(1);
  });

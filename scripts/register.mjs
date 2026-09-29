import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-ext-loader.mjs", pathToFileURL("./scripts/"));

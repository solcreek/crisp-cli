import { register } from "node:module"
register(new URL("./deny-transports-loader.mjs", import.meta.url), {
  data: {
    names: process.env.CRISPCTL_TEST_FORBID_TRANSPORTS.split(","),
    cancel: process.env.CRISPCTL_TEST_CANCEL_IMPORT === "1",
  },
})

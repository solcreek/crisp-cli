let denied
let cancel
export function initialize(options) {
  denied = new Set(options.names)
  cancel = options.cancel
}
export async function resolve(specifier, context, nextResolve) {
  if (cancel && specifier === "undici")
    return { url: new URL("./cancel-import.mjs", import.meta.url).href, shortCircuit: true }
  if (denied.has(specifier)) throw new Error("unexpected transport module load")
  return nextResolve(specifier, context)
}

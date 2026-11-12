if (location.hostname === "appassets.androidplatform.net") {
  const { install } = await import("./offline-runtime.mjs")
  await install()
}

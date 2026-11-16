export function applyScanFilter(data, width, height, options = {}) {
  const filter = options.filter || 'photo', clamp = value => Math.max(0, Math.min(255, value))
  const brightness = Math.max(-100, Math.min(100, Number(options.brightness) || 0))
  const contrast = 1 + Math.max(-80, Math.min(100, Number(options.contrast) || 0)) / 100
  const whitening = Math.max(0, Math.min(100, Number(options.whitening) || 0)) / 100
  const sharpen = Math.max(0, Math.min(100, Number(options.sharpness) || 0)) / 100
  const source = new Uint8ClampedArray(data), integral = new Float64Array((width + 1) * (height + 1)), stride = width + 1
  for (let y = 0; y < height; y++) { let sum = 0; for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; sum += source[i] * .299 + source[i + 1] * .587 + source[i + 2] * .114
    integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum
  } }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, light = source[i] * .299 + source[i + 1] * .587 + source[i + 2] * .114
    const left = Math.max(0, x - 20), right = Math.min(width, x + 21), top = Math.max(0, y - 20), bottom = Math.min(height, y + 21)
    const mean = (integral[bottom * stride + right] - integral[top * stride + right] - integral[bottom * stride + left] + integral[top * stride + left]) / ((right - left) * (bottom - top))
    for (let c = 0; c < 3; c++) {
      let value = source[i + c]
      if (filter === 'invert') value = 255-value
      if (filter === 'grayscale') value = light
      if (filter === 'bw') value = light < 160 ? 0 : 255
      if (filter === 'receipt') value = light < mean - 14 ? 0 : 255
      if (filter === 'document') value = light * 255 / Math.max(60, mean)
      if (filter === 'colour') value *= 245 / Math.max(100, mean)
      if (filter === 'auto') value = (value - 128) * 1.15 + 140
      if (filter === 'clean') value *= 255 / Math.max(70, mean)
      if (sharpen) {
        const neighbours = [Math.max(0, x - 1) + y * width, Math.min(width - 1, x + 1) + y * width, x + Math.max(0, y - 1) * width, x + Math.min(height - 1, y + 1) * width]
        value += sharpen * (source[i + c] - neighbours.reduce((sum, p) => sum + source[p * 4 + c], 0) / 4)
      }
      value = (value - 128) * contrast + 128 + brightness
      if (light > 150) value += (255 - value) * whitening * (light - 150) / 105
      data[i + c] = clamp(value)
    }
  }
  return data
}

import AppKit

guard CommandLine.arguments.count == 3 else {
  fputs("Usage: make-app-icon.swift <source.png> <destination.png>\n", stderr)
  exit(1)
}

let sourcePath = CommandLine.arguments[1]
let destinationPath = CommandLine.arguments[2]
let canvas = NSSize(width: 1024, height: 1024)

guard let source = NSImage(contentsOfFile: sourcePath) else {
  fputs("Unable to load source icon: \(sourcePath)\n", stderr)
  exit(1)
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: 1024,
  pixelsHigh: 1024,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Unable to create the application icon canvas.\n", stderr)
  exit(1)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSGraphicsContext.current?.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(origin: .zero, size: canvas).fill()

// Keep the modern macOS squircle while removing generated pixels outside it.
let iconBounds = NSRect(x: 38, y: 54, width: 948, height: 916)
NSBezierPath(roundedRect: iconBounds, xRadius: 190, yRadius: 190).addClip()
source.draw(
  in: NSRect(origin: .zero, size: canvas),
  from: NSRect(origin: .zero, size: source.size),
  operation: .sourceOver,
  fraction: 1
)
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("Unable to encode the generated application icon.\n", stderr)
  exit(1)
}

try png.write(to: URL(fileURLWithPath: destinationPath), options: .atomic)

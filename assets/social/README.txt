Icons from the baker's own downloaded set: ~/Desktop/Social Icons/*.png
(Facebook, Instagram, LinkedIn, Pinterest, TikTok, WhatsApp, X — resized to
240x240, filenames lowercased to match socialPlatform() in baker/index.html).

Each PNG is a solid black circle with the platform's logo cut out as fully
transparent — not just a white glyph on black. That's deliberate: in
baker/index.html (#social-icons), a theme-colored layer (var(--accent), the
baker's actual selected_theme color) sits behind the image, so the logo
shape shows through the cutout in the bakery's theme color while the circle
itself stays a plain black badge. Confirm this cutout convention holds
before adding a platform this same way — a plain filled icon (glyph drawn
solid instead of cut out) wouldn't pick up the theme color at all.

To add a platform: crop/export the same way (black circle, logo cut out
transparent, square canvas, circle touching all four edges) and wire it
into socialPlatform() in baker/index.html.

import SwiftUI

// MARK: - Color + Bakerly Palette
// Derived from BakerlyColorPalette.png

extension Color {

    // ── Browns / Creams ──────────────────────────────────────────────────
    static let bakerlyBeige      = Color(hex: "#F0E2CD")  // warm cream – main bg tint
    static let bakerlyTan        = Color(hex: "#D1B98F")  // medium tan
    static let bakerlyWarmBrown  = Color(hex: "#A79371")  // warm brown
    static let bakerlyCacao      = Color(hex: "#756F55")  // deep cacao
    static let bakerlyDarkBrown  = Color(hex: "#584D3A")  // dark brown
    static let bakerlyDeepBrown  = Color(hex: "#352021")  // very deep brown
    static let bakerlyEspresso   = Color(hex: "#14100A")  // near-black

    // ── Oranges / Terracotta (primary accent) ───────────────────────────
    static let bakerlyPeach      = Color(hex: "#FCE7E2")  // pale peach
    static let bakerlySalmon     = Color(hex: "#F7B49D")  // salmon
    static let bakerlyOrange     = Color(hex: "#EF7E3D")  // vivid orange accent
    static let bakerlyTerracotta = Color(hex: "#B8602D")  // terracotta – brand primary
    static let bakerlyRust       = Color(hex: "#84431E")  // rust

    // ── Yellows / Gold ───────────────────────────────────────────────────
    static let bakerlyLemon      = Color(hex: "#F8E7D2")  // soft lemon cream
    static let bakerlyGold       = Color(hex: "#E5BB74")  // warm gold
    static let bakerlyAmber      = Color(hex: "#B89955")  // amber

    // ── Blues (status: confirmed / paid) ─────────────────────────────────
    static let bakerlyBlueLight  = Color(hex: "#D7E0F8")
    static let bakerlyBlueMid    = Color(hex: "#5F92E6")
    static let bakerlyBlue       = Color(hex: "#3D6DB7")
    static let bakerlyBlueDark   = Color(hex: "#284B80")

    // ── Reds / Pinks (status: cancelled / alert) ─────────────────────────
    static let bakerlyPink       = Color(hex: "#F8EFEF")
    static let bakerlyRed        = Color(hex: "#D06767")
    static let bakerlyCrimson    = Color(hex: "#A24545")

    // ── Neutrals ─────────────────────────────────────────────────────────
    static let bakerlyGray1      = Color(hex: "#E5E3E1")
    static let bakerlyGray2      = Color(hex: "#BFBBB6")
    static let bakerlyGray3      = Color(hex: "#989591")
    static let bakerlyGray4      = Color(hex: "#737D6D")
    static let bakerlyGray5      = Color(hex: "#504E4C")
    static let bakerlyGray6      = Color(hex: "#2F2E2C")

    // ── Semantic (auto dark/light) ────────────────────────────────────────
    static var bakerlyPrimary: Color    { .bakerlyTerracotta }
    static var bakerlyAccent: Color     { .bakerlyOrange }
    static var bakerlyBackground: Color { Color(.systemBackground) }
    static var bakerlySecondary: Color  { Color(.secondarySystemBackground) }
    static var bakerlyGrouped: Color    { Color(.systemGroupedBackground) }

    // MARK: - Hex initialiser
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:  (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:  (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:  (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(.sRGB,
                  red: Double(r) / 255,
                  green: Double(g) / 255,
                  blue: Double(b) / 255,
                  opacity: Double(a) / 255)
    }
}

// MARK: - OrderStatus Colors

extension OrderStatus {
    var statusColor: Color {
        switch self {
        case .new:       return .bakerlyBlue
        case .confirmed: return .bakerlyBlueMid
        case .baking:    return .bakerlyOrange
        case .ready:     return .bakerlyGold
        case .delivered: return Color(hex: "#4CAF50")
        case .cancelled: return .bakerlyRed
        }
    }
    var statusBgColor: Color { statusColor.opacity(0.15) }
    var statusTextColor: Color { statusColor }
}

// MARK: - Typography Helpers

enum BakerlyFont {
    static func display(_ size: CGFloat = 32) -> Font {
        .system(size: size, weight: .bold, design: .rounded)
    }
    static func heading(_ size: CGFloat = 20) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }
    static func subheading(_ size: CGFloat = 16) -> Font {
        .system(size: size, weight: .medium, design: .rounded)
    }
    static func body(_ size: CGFloat = 15) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }
    static func caption(_ size: CGFloat = 12) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }
    static func mono(_ size: CGFloat = 14) -> Font {
        .system(size: size, weight: .regular, design: .monospaced)
    }
}

// MARK: - View Modifiers

struct BakerlyCardModifier: ViewModifier {
    var cornerRadius: CGFloat = 16
    var shadowOpacity: Double = 0.07

    func body(content: Content) -> some View {
        content
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .shadow(color: .black.opacity(shadowOpacity), radius: 8, x: 0, y: 2)
    }
}

struct BakerlyPrimaryButtonModifier: ViewModifier {
    var isFullWidth: Bool = false

    func body(content: Content) -> some View {
        content
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.horizontal, isFullWidth ? 0 : 24)
            .padding(.vertical, 14)
            .frame(maxWidth: isFullWidth ? .infinity : nil)
            .background(Color.bakerlyTerracotta)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct BakerlySecondaryButtonModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 15, weight: .medium, design: .rounded))
            .foregroundStyle(Color.bakerlyTerracotta)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(Color.bakerlyTerracotta.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

extension View {
    func bakerlyCard(cornerRadius: CGFloat = 16) -> some View {
        modifier(BakerlyCardModifier(cornerRadius: cornerRadius))
    }
    func bakerlyPrimaryButton(fullWidth: Bool = false) -> some View {
        modifier(BakerlyPrimaryButtonModifier(isFullWidth: fullWidth))
    }
    func bakerlySecondaryButton() -> some View {
        modifier(BakerlySecondaryButtonModifier())
    }
}

// MARK: - Status Pill

struct StatusPill: View {
    let status: OrderStatus
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: status.sfSymbol)
                .font(.system(size: 11, weight: .semibold))
            Text(status.rawValue)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(status.statusColor)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(status.statusBgColor)
        .clipShape(Capsule())
    }
}

// MARK: - Tag Chip

struct TagChip: View {
    let tag: String
    var isSelected: Bool = false
    var onTap: (() -> Void)? = nil

    var body: some View {
        Text(tag)
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(isSelected ? .white : Color.bakerlyTerracotta)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.bakerlyTerracotta : Color.bakerlyTerracotta.opacity(0.12))
            .clipShape(Capsule())
            .onTapGesture { onTap?() }
    }
}

// MARK: - Section Header

struct BakerlySectionHeader: View {
    let title: String
    var trailing: String? = nil
    var trailingAction: (() -> Void)? = nil

    var body: some View {
        HStack {
            Text(title)
                .font(BakerlyFont.subheading())
                .foregroundStyle(Color.primary)
            Spacer()
            if let trailing = trailing {
                Button(action: { trailingAction?() }) {
                    Text(trailing)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.bakerlyTerracotta)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }
}

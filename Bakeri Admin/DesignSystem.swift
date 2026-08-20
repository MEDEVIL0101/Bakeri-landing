//
//  DesignSystem.swift
//  Bakeri Admin
//
//  Design tokens — Bakeri Classic: black, cream, blue, tan-grey.
//

import SwiftUI

// MARK: - Hex convenience (local to this module)

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        self.init(
            .sRGB,
            red:     Double((v >> 16) & 0xFF) / 255,
            green:   Double((v >>  8) & 0xFF) / 255,
            blue:    Double( v        & 0xFF) / 255,
            opacity: 1
        )
    }
}

// MARK: - Tokens

enum DS {
    // ── Sidebar — Quiver-style light panel ───────────────────
    static let sidebarBg        = Color(hex: "#F4F4F6")   // light grey panel
    static let sidebarBorder    = Color(hex: "#DCDCE0")   // right-edge divider
    static let sidebarText      = Color(hex: "#6B6B73")   // mid grey
    static let sidebarTextHi    = Color(hex: "#1C1C1E")   // near-black (selected / title)

    // ── Page & cards — white canvas ──────────────────────────
    static let pageBg           = Color(hex: "#F8F9FA")   // near-white canvas
    static let cardBg           = Color(hex: "#FFFFFF")   // pure white cards
    static let cardBorder       = Color(hex: "#E0E0E4")   // 1 px card border

    // ── Brand — blue ─────────────────────────────────────────
    static let brand            = Color(hex: "#3B7EED")   // bakeriBlue CTA
    static let brandLight       = Color(hex: "#3B7EED").opacity(0.08)
    static let brandDark        = Color(hex: "#2563C4")   // deep press state

    // ── Semantic ─────────────────────────────────────────────
    static let success          = Color(hex: "#22C55E")   // green
    static let warning          = Color(hex: "#F59E0B")   // amber
    static let danger           = Color(hex: "#EF4444")   // red
    static let info             = Color(hex: "#60A5FA")   // sky blue
    static let gold             = Color(hex: "#EAB308")   // golden yellow

    // ── Text ─────────────────────────────────────────────────
    static let textPrimary      = Color(hex: "#1C1C1E")   // near-black
    static let textSecondary    = Color(hex: "#48484A")   // dark grey
    static let textTertiary     = Color(hex: "#8E8E93")   // mid grey
}

// MARK: - Card modifier

struct CardStyle: ViewModifier {
    var padding: CGFloat = 20
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(DS.cardBorder, lineWidth: 1))
            .shadow(color: Color.black.opacity(0.03), radius: 3, x: 0, y: 1)
    }
}

extension View {
    func cardStyle(padding: CGFloat = 20) -> some View { modifier(CardStyle(padding: padding)) }
}

// MARK: - Section label

struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.9)
            .foregroundStyle(DS.textTertiary)
    }
}

// MARK: - Avatar / initials

struct InitialsAvatar: View {
    let name: String
    var size: CGFloat = 40
    var cornerRadius: CGFloat = 10
    var color: Color = DS.brand

    private var initials: String {
        let parts = name.split(separator: " ")
        if parts.count >= 2 { return "\(parts[0].prefix(1))\(parts[1].prefix(1))".uppercased() }
        return String(name.prefix(2)).uppercased()
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(color.opacity(0.13))
                .frame(width: size, height: size)
            Text(initials)
                .font(.system(size: size * 0.36, weight: .bold))
                .foregroundStyle(color)
        }
    }
}

// MARK: - Status badge (user account)

struct UserStatusBadge: View {
    let status: UserAccountStatus
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(status.color).frame(width: 6, height: 6)
            Text(status.label).font(.system(size: 11, weight: .medium))
        }
        .foregroundStyle(status.color)
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(status.color.opacity(0.10))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(status.color.opacity(0.20), lineWidth: 0.5))
    }
}

// MARK: - Role badge

struct RoleBadge: View {
    let isBaker: Bool
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: isBaker ? "oven.fill" : "cart.fill")
                .font(.system(size: 9, weight: .bold))
            Text(isBaker ? "Baker" : "Buyer")
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(isBaker ? DS.brand : DS.info)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background((isBaker ? DS.brand : DS.info).opacity(0.10))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder((isBaker ? DS.brand : DS.info).opacity(0.25), lineWidth: 0.5))
    }
}

// MARK: - Stripe connect status badge

struct StripeStatusBadge: View {
    let connected: Bool
    let started: Bool

    private var color: Color {
        if connected { return DS.success }
        if started { return DS.warning }
        return DS.textTertiary
    }
    private var label: String {
        if connected { return "Connected" }
        if started { return "In Progress" }
        return "Not Connected"
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: connected ? "checkmark.circle.fill" : (started ? "clock.fill" : "xmark.circle.fill"))
                .font(.system(size: 9, weight: .bold))
            Text(label).font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(color.opacity(0.10))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.25), lineWidth: 0.5))
    }
}

// MARK: - Ticket urgency badge

struct UrgencyBadge: View {
    let urgency: TicketUrgency
    var body: some View {
        Text(urgency.label)
            .font(.system(size: 10, weight: .bold))
            .tracking(0.4)
            .foregroundStyle(urgency.color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(urgency.color.opacity(0.10))
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(urgency.color.opacity(0.25), lineWidth: 0.5))
    }
}

// MARK: - Ticket status badge

struct TicketStatusBadge: View {
    let status: TicketStatus
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(status.color).frame(width: 6, height: 6)
            Text(status.label).font(.system(size: 11, weight: .medium))
        }
        .foregroundStyle(status.color)
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(status.color.opacity(0.10))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(status.color.opacity(0.20), lineWidth: 0.5))
    }
}

// MARK: - Listing kind badge

struct ListingKindBadge: View {
    let kind: ListingKind
    var body: some View {
        Text(kind.label)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(kind.color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(kind.color.opacity(0.10))
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(kind.color.opacity(0.30), lineWidth: 0.5))
    }
}

// MARK: - Live indicator

struct LiveIndicator: View {
    @State private var pulsing = false
    var body: some View {
        HStack(spacing: 4) {
            ZStack {
                Circle().fill(DS.success.opacity(0.30)).frame(width: 10, height: 10)
                    .scaleEffect(pulsing ? 1.6 : 1.0).opacity(pulsing ? 0 : 1)
                Circle().fill(DS.success).frame(width: 6, height: 6)
            }
            Text("LIVE")
                .font(.system(size: 9, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(DS.success)
        }
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(DS.success.opacity(0.10))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(DS.success.opacity(0.20), lineWidth: 0.5))
        .onAppear {
            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) { pulsing = true }
        }
    }
}

// MARK: - KPI Stat Card

struct KPICard: View {
    let title: String
    let value: String
    let subtitle: String?
    var icon: String = "chart.bar.fill"
    var iconColor: Color = DS.brand
    var trend: Double? = nil
    var action: (() -> Void)? = nil

    @State private var isHovering = false

    var body: some View {
        if let action {
            Button(action: action) { content }
                .buttonStyle(.plain)
                .onHover { isHovering = $0 }
        } else {
            content
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 7) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(iconColor.opacity(0.12))
                            .frame(width: 26, height: 26)
                        Image(systemName: icon)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(iconColor)
                    }
                    Text(title.uppercased())
                        .font(.system(size: 9, weight: .bold))
                        .tracking(0.7)
                        .foregroundStyle(DS.textTertiary)
                }
                Spacer()
                if let t = trend {
                    HStack(spacing: 2) {
                        Image(systemName: t >= 0 ? "arrow.up.right" : "arrow.down.right")
                            .font(.system(size: 9, weight: .bold))
                        Text(String(format: "%.1f%%", abs(t)))
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(t >= 0 ? DS.success : DS.danger)
                } else if action != nil {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(isHovering ? DS.brand : DS.textTertiary)
                }
            }
            .padding(.bottom, 14)

            Text(value)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(DS.textPrimary)

            if let sub = subtitle {
                Text(sub)
                    .font(.system(size: 11))
                    .foregroundStyle(DS.textSecondary)
                    .padding(.top, 4)
            }
        }
        .cardStyle()
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
            .strokeBorder(isHovering ? DS.brand.opacity(0.35) : Color.clear, lineWidth: 1.5))
    }
}

// MARK: - Empty state placeholder

struct EmptyDetailView: View {
    let icon: String
    let message: String
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 48))
                .foregroundStyle(DS.textTertiary)
            Text(message)
                .font(.title3)
                .foregroundStyle(DS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.pageBg)
    }
}

// MARK: - Confirm Destructive Sheet

struct ConfirmDestructiveSheet: View {
    let title: String
    let message: String
    let confirmLabel: String
    var requiresReason: Bool = false
    @Binding var reason: String
    let onConfirm: () -> Void
    @Environment(\.dismiss) private var dismiss

    var canConfirm: Bool { !requiresReason || !reason.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(DS.danger.opacity(0.12)).frame(width: 44, height: 44)
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(DS.danger)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(DS.textPrimary)
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundStyle(DS.textSecondary)
                }
            }
            .padding(24)

            if requiresReason {
                Divider().foregroundStyle(DS.cardBorder)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Reason (required for audit log)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DS.textSecondary)
                    TextEditor(text: $reason)
                        .font(.system(size: 13))
                        .frame(height: 80)
                        .padding(8)
                        .background(DS.pageBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
            }

            Divider().foregroundStyle(DS.cardBorder)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.plain)
                    .foregroundStyle(DS.textSecondary)
                    .padding(.horizontal, 20).padding(.vertical, 9)
                    .background(DS.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(DS.cardBorder))

                Button(confirmLabel) { onConfirm(); dismiss() }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20).padding(.vertical, 9)
                    .background(canConfirm ? DS.danger : DS.danger.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                    .disabled(!canConfirm)
            }
            .padding(24)
        }
        .frame(width: 460)
        .background(DS.cardBg)
    }
}

//
//  SidebarView.swift
//  Bakeri Admin
//
//  Quiver-style light sidebar: light grey panel, dark text, blue accent on selection.
//

import SwiftUI

struct SidebarView: View {
    @Binding var selection: SidebarItem?
    let stats: BakeriDashboardStats

    var body: some View {
        VStack(spacing: 0) {
            logoHeader
            Divider().background(DS.sidebarBorder)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    navSection("Overview") {
                        navItem(.dashboard, icon: "square.grid.2x2",              label: "Command Centre")
                        navItem(.analytics, icon: "chart.line.uptrend.xyaxis",    label: "Analytics")
                    }
                    navSection("Marketplace") {
                        navItem(.readyNow,    icon: "bolt",                    label: "Ready Now")
                        navItem(.preOrders,   icon: "calendar.badge.clock",   label: "Pre-Orders")
                        navItem(.commissions, icon: "paintbrush.pointed",      label: "Custom Orders")
                        navItem(.orders,      icon: "bag.fill",                label: "All Orders")
                    }
                    navSection("Users") {
                        navItem(.users, icon: "person.2",                         label: "All Users",
                                badge: stats.totalUsers, badgeColor: DS.brand)
                        navItem(.userMap, icon: "map",                            label: "User Map")
                    }
                    navSection("Support") {
                        navItem(.support, icon: "bubble.left.and.bubble.right",   label: "Feedback Queue",
                                badge: stats.openTickets, badgeColor: DS.danger)
                    }
                }
                .padding(.vertical, 6)
                .padding(.bottom, 12)
            }
            Spacer()
            footerBar
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.sidebarBg)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(DS.sidebarBorder)
                .frame(width: 1)
        }
    }

    // MARK: - Logo header

    private var logoHeader: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(DS.brand)
                    .frame(width: 30, height: 30)
                Text("🥐").font(.system(size: 16))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text("Bakeri")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DS.sidebarTextHi)
                    .lineLimit(1)
                Text("Admin Panel")
                    .font(.system(size: 10))
                    .foregroundStyle(DS.sidebarText)
                    .lineLimit(1)
            }
            .layoutPriority(1)
            Spacer(minLength: 6)
            Circle()
                .fill(DS.success)
                .frame(width: 6, height: 6)
        }
        .padding(.horizontal, 14)
        .padding(.top, 16)
        .padding(.bottom, 12)
    }

    // MARK: - Section wrapper

    @ViewBuilder
    private func navSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(DS.sidebarText.opacity(0.6))
                .padding(.horizontal, 14)
                .padding(.top, 18)
                .padding(.bottom, 3)
            content()
        }
    }

    // MARK: - Nav item

    private func navItem(
        _ item: SidebarItem, icon: String, label: String,
        badge: Int = 0, badgeColor: Color = DS.warning
    ) -> some View {
        let isSelected = selection == item
        return Button { selection = item } label: {
            HStack(spacing: 0) {
                // left accent bar
                Rectangle()
                    .fill(isSelected ? DS.brand : Color.clear)
                    .frame(width: 2.5)
                    .padding(.vertical, 4)

                HStack(spacing: 8) {
                    Image(systemName: icon)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(isSelected ? DS.brand : DS.sidebarText)
                        .frame(width: 14)
                    Text(label)
                        .font(.system(size: 12.5, weight: isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected ? DS.sidebarTextHi : DS.sidebarText)
                        .lineLimit(1)
                        .layoutPriority(1)
                    Spacer(minLength: 4)
                    if badge > 0 {
                        Text("\(badge)")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(isSelected ? .white : badgeColor)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(isSelected ? badgeColor : badgeColor.opacity(0.15))
                            .clipShape(Capsule())
                    }
                }
                .padding(.vertical, 7)
                .padding(.leading, 10)
                .padding(.trailing, 12)
                .background(isSelected ? DS.brand.opacity(0.08) : Color.clear)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Footer

    private var footerBar: some View {
        VStack(spacing: 0) {
            Divider().background(DS.sidebarBorder)
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(DS.brand.opacity(0.12))
                        .frame(width: 28, height: 28)
                    Text("A")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(DS.brand)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text("Administrator")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DS.sidebarTextHi)
                        .lineLimit(1)
                    Text("Service Role")
                        .font(.system(size: 10))
                        .foregroundStyle(DS.sidebarText)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                HStack(spacing: 3) {
                    Circle().fill(DS.success).frame(width: 5, height: 5)
                    Text("Live")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(DS.success)
                }
                .fixedSize()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }
}

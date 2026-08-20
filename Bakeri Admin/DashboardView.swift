//
//  DashboardView.swift
//  Bakeri Admin
//
//  Module 1 — Network Telemetry & Analytics (The Pulse).
//  KPI ribbons, user segmentation, 30-day sparkline, quick-action tiles.
//

import SwiftUI
import Charts

struct DashboardView: View {
    let stats: BakeriDashboardStats
    let isLoading: Bool
    let onRefresh: () -> Void
    var onGoToListings:    (() -> Void)? = nil
    var onGoToUsers:       (() -> Void)? = nil
    var onGoToSupport:     (() -> Void)? = nil
    var onGoToAnalytics:   (() -> Void)? = nil
    var onGoToCommissions: (() -> Void)? = nil

    @State private var chartRange: ChartRange = .thirtyDay

    private var dateString: String {
        let f = DateFormatter()
        f.dateFormat = "EEEE, MMMM d, yyyy"
        return f.string(from: Date())
    }

    private var filteredMetrics: [DailyMetric] {
        let all = MockData.dailyMetrics
        switch chartRange {
        case .sevenDay:   return Array(all.suffix(7))
        case .thirtyDay:  return all
        }
    }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    pageHeader
                    kpiRibbon
                    Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                    userSegmentationCard
                    Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                    supportHealthSection
                    Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                    networkChartSection
                    Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                    quickActionsSection
                }
                .padding(32)
            }
        }
    }

    // MARK: - Page header

    private var pageHeader: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text("Command Centre")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(DS.textPrimary)
                    LiveIndicator()
                }
                HStack(spacing: 5) {
                    Image(systemName: "calendar")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(DS.textTertiary)
                    Text(dateString)
                        .font(.system(size: 13))
                        .foregroundStyle(DS.textSecondary)
                }
            }
            Spacer()
            Button { onRefresh() } label: {
                HStack(spacing: 6) {
                    if isLoading {
                        ProgressView().scaleEffect(0.65).frame(width: 12, height: 12)
                    } else {
                        Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .medium))
                    }
                    Text("Refresh").font(.system(size: 13, weight: .medium))
                }
                .foregroundStyle(DS.textSecondary)
                .padding(.horizontal, 16).padding(.vertical, 9)
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(DS.cardBorder, lineWidth: 1))
                .shadow(color: .black.opacity(0.04), radius: 4, x: 0, y: 1)
            }
            .buttonStyle(.plain)
            .disabled(isLoading)
        }
    }

    // MARK: - KPI ribbon (5 stat cards)

    private var kpiRibbon: some View {
        HStack(spacing: 14) {
            KPICard(
                title: "Network Users",
                value: "\(stats.totalUsers)",
                subtitle: "+\(stats.newUsersToday) today · +\(stats.newUsersThisWeek) this week",
                icon: "person.2.fill",
                iconColor: DS.brand,
                trend: 12.4,
                action: onGoToUsers
            )
            KPICard(
                title: "30-Day GTV",
                value: formatCurrency(stats.gtv30d),
                subtitle: "Gross transaction volume",
                icon: "arrow.left.arrow.right.circle.fill",
                iconColor: DS.success,
                trend: 8.2,
                action: onGoToAnalytics
            )
            KPICard(
                title: "Platform Revenue",
                value: formatCurrency(stats.revenue30d),
                subtitle: "5% fee · 30-day",
                icon: "percent",
                iconColor: DS.gold,
                trend: 8.2,
                action: onGoToAnalytics
            )
            KPICard(
                title: "Avg. Order Value",
                value: formatCurrency(stats.aov),
                subtitle: "Per marketplace transaction",
                icon: "cart.fill",
                iconColor: DS.info,
                trend: 3.1,
                action: onGoToAnalytics
            )
            KPICard(
                title: "Open Support",
                value: "\(stats.openTickets)",
                subtitle: "\(stats.resolvedTickets) resolved all-time",
                icon: "bubble.left.and.bubble.right.fill",
                iconColor: stats.openTickets > 5 ? DS.danger : DS.warning,
                trend: nil,
                action: onGoToSupport
            )
        }
    }

    // MARK: - User segmentation

    private var userSegmentationCard: some View {
        VStack(alignment: .leading, spacing: 20) {
            SectionLabel(text: "User Segmentation")

            HStack(spacing: 32) {
                // Total users hero
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(stats.totalUsers)")
                        .font(.system(size: 52, weight: .bold, design: .rounded))
                        .foregroundStyle(DS.textPrimary)
                    Text("Total Network Users")
                        .font(.system(size: 13))
                        .foregroundStyle(DS.textSecondary)
                }

                Divider().frame(height: 80)

                // Baker segment
                segmentBlock(
                    label: "Bakers", count: stats.totalBakers,
                    pct: stats.totalUsers > 0 ? Double(stats.totalBakers) / Double(stats.totalUsers) : 0,
                    color: DS.brand, icon: "oven.fill", action: onGoToUsers
                )

                // Buyer segment
                segmentBlock(
                    label: "Buyers", count: stats.totalBuyers,
                    pct: stats.totalUsers > 0 ? Double(stats.totalBuyers) / Double(stats.totalUsers) : 0,
                    color: DS.info, icon: "cart.fill", action: onGoToUsers
                )

                Divider().frame(height: 80)

                // Ratio bar
                VStack(alignment: .leading, spacing: 8) {
                    Text("Baker : Buyer Ratio").font(.system(size: 11, weight: .medium)).foregroundStyle(DS.textSecondary)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4).fill(DS.info.opacity(0.2)).frame(height: 12)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(LinearGradient(colors: [DS.brand, DS.brand.opacity(0.7)],
                                                     startPoint: .leading, endPoint: .trailing))
                                .frame(width: stats.totalUsers > 0 ? geo.size.width * CGFloat(stats.totalBakers) / CGFloat(stats.totalUsers) : 0,
                                       height: 12)
                        }
                    }
                    .frame(height: 12)
                    .frame(maxWidth: 240)
                    Text(stats.totalBakers > 0
                         ? "1:\(String(format: "%.1f", Double(stats.totalBuyers) / Double(max(stats.totalBakers, 1)))) baker-to-buyer"
                         : "—")
                    .font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                }
            }
            .cardStyle()
        }
    }

    private func segmentBlock(label: String, count: Int, pct: Double, color: Color, icon: String, action: (() -> Void)? = nil) -> some View {
        let block = VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(color)
                Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(DS.textSecondary)
                if action != nil {
                    Image(systemName: "arrow.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(DS.textTertiary)
                }
            }
            Text("\(count)")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(DS.textPrimary)
            Text(String(format: "%.1f%% of network", pct * 100))
                .font(.system(size: 11)).foregroundStyle(DS.textTertiary)
        }
        return Group {
            if let action {
                Button(action: action) { block }.buttonStyle(.plain)
            } else {
                block
            }
        }
    }

    // MARK: - Support health

    private var supportHealthSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            SectionLabel(text: "Support Health")

            HStack(alignment: .top, spacing: 14) {
                // Status breakdown
                VStack(alignment: .leading, spacing: 14) {
                    Text("Ticket Status")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)

                    let total = max(1, stats.openTickets + stats.resolvedTickets + stats.escalatedTickets)
                    let statusItems: [(String, Int, Color)] = [
                        ("Open",      stats.openTickets,      DS.danger),
                        ("Escalated", stats.escalatedTickets, Color(red: 180/255, green: 80/255, blue: 220/255)),
                        ("Resolved",  stats.resolvedTickets,  DS.success),
                    ]
                    VStack(spacing: 8) {
                        ForEach(statusItems, id: \.0) { label, count, color in
                            Button { onGoToSupport?() } label: {
                                HStack(spacing: 10) {
                                    Circle().fill(color).frame(width: 8, height: 8)
                                    Text(label).font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                                    Spacer()
                                    Text("\(count)").font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textPrimary)
                                    GeometryReader { geo in
                                        ZStack(alignment: .leading) {
                                            RoundedRectangle(cornerRadius: 2).fill(DS.cardBorder).frame(height: 4)
                                            RoundedRectangle(cornerRadius: 2).fill(color)
                                                .frame(width: geo.size.width * CGFloat(count) / CGFloat(total), height: 4)
                                        }
                                    }
                                    .frame(width: 80, height: 4)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .cardStyle()
                .frame(maxWidth: .infinity)

                // Category breakdown
                VStack(alignment: .leading, spacing: 14) {
                    Text("By Category")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)

                    if stats.ticketsByCategory.isEmpty {
                        Text("No tickets yet").font(.system(size: 12)).foregroundStyle(DS.textTertiary)
                    } else {
                        let sorted = stats.ticketsByCategory.sorted { $0.value > $1.value }
                        let catTotal = max(1, sorted.map(\.value).reduce(0, +))
                        VStack(spacing: 8) {
                            ForEach(sorted.prefix(5), id: \.key) { cat, count in
                                Button { onGoToSupport?() } label: {
                                    HStack(spacing: 8) {
                                        Text(cat.replacingOccurrences(of: "_", with: " ").capitalized)
                                            .font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                                            .frame(width: 90, alignment: .leading)
                                        GeometryReader { geo in
                                            ZStack(alignment: .leading) {
                                                RoundedRectangle(cornerRadius: 2).fill(DS.cardBorder).frame(height: 4)
                                                RoundedRectangle(cornerRadius: 2).fill(DS.brand)
                                                    .frame(width: geo.size.width * CGFloat(count) / CGFloat(catTotal), height: 4)
                                            }
                                        }
                                        .frame(height: 4)
                                        Text("\(count)").font(.system(size: 11, weight: .medium)).foregroundStyle(DS.textTertiary)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .cardStyle()
                .frame(maxWidth: .infinity)

                // Health score card
                VStack(alignment: .leading, spacing: 14) {
                    Text("Queue Health")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)

                    let total2 = stats.openTickets + stats.resolvedTickets + stats.escalatedTickets
                    let resolvedPct = total2 > 0 ? Double(stats.resolvedTickets) / Double(total2) : 1.0
                    let healthColor: Color = stats.escalatedTickets > 0 ? DS.danger
                                          : stats.openTickets > 5       ? DS.warning : DS.success
                    let healthLabel = stats.escalatedTickets > 0 ? "Needs Attention"
                                    : stats.openTickets > 5      ? "Busy"           : "Healthy"

                    VStack(spacing: 12) {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().stroke(DS.cardBorder, lineWidth: 6).frame(width: 64, height: 64)
                                Circle()
                                    .trim(from: 0, to: resolvedPct)
                                    .stroke(healthColor, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                                    .rotationEffect(.degrees(-90))
                                    .frame(width: 64, height: 64)
                                Text("\(Int(resolvedPct * 100))%")
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(DS.textPrimary)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(healthLabel)
                                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(healthColor)
                                Text("resolution rate").font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                                if stats.escalatedTickets > 0 {
                                    Text("\(stats.escalatedTickets) escalated")
                                        .font(.system(size: 11, weight: .medium)).foregroundStyle(DS.danger)
                                }
                            }
                        }
                        Button { onGoToSupport?() } label: {
                            HStack(spacing: 5) {
                                Text("Open Queue").font(.system(size: 12, weight: .medium))
                                Image(systemName: "arrow.right").font(.system(size: 10))
                            }
                            .foregroundStyle(DS.brand)
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(DS.brand.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .cardStyle()
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Network chart

    private var networkChartSection: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                SectionLabel(text: "Network Activity")
                Spacer()
                Picker("Range", selection: $chartRange) {
                    Text("7D").tag(ChartRange.sevenDay)
                    Text("30D").tag(ChartRange.thirtyDay)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 120)
            }

            HStack(alignment: .top, spacing: 14) {
                // GTV line chart
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Gross Transaction Volume")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)
                        Text(formatCurrency(filteredMetrics.map(\.gtv).reduce(0, +)))
                            .font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(DS.textPrimary)
                    }
                    Chart(filteredMetrics) { m in
                        LineMark(
                            x: .value("Date", m.date, unit: .day),
                            y: .value("GTV", m.gtv)
                        )
                        .foregroundStyle(DS.brand)
                        .lineStyle(StrokeStyle(lineWidth: 2.5))
                        AreaMark(
                            x: .value("Date", m.date, unit: .day),
                            y: .value("GTV", m.gtv)
                        )
                        .foregroundStyle(
                            LinearGradient(colors: [DS.brand.opacity(0.25), DS.brand.opacity(0.0)],
                                           startPoint: .top, endPoint: .bottom)
                        )
                    }
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .day, count: chartRange == .sevenDay ? 1 : 5)) { _ in
                            AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                            AxisValueLabel(format: .dateTime.month().day(), centered: false)
                                .font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                        }
                    }
                    .chartYAxis {
                        AxisMarks(position: .leading) { v in
                            AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                            AxisValueLabel {
                                if let d = v.as(Double.self) {
                                    Text("$\(Int(d))").font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                                }
                            }
                        }
                    }
                    .frame(height: 200)
                }
                .cardStyle()
                .frame(maxWidth: .infinity)

                // Orders bar chart
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Order Volume")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)
                        Text("\(filteredMetrics.map(\.orders).reduce(0, +)) orders")
                            .font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(DS.textPrimary)
                    }
                    Chart(filteredMetrics) { m in
                        BarMark(
                            x: .value("Date", m.date, unit: .day),
                            y: .value("Orders", m.orders)
                        )
                        .foregroundStyle(
                            LinearGradient(colors: [DS.success, DS.success.opacity(0.6)],
                                           startPoint: .top, endPoint: .bottom)
                        )
                        .cornerRadius(3)
                    }
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .day, count: chartRange == .sevenDay ? 1 : 5)) { _ in
                            AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                            AxisValueLabel(format: .dateTime.month().day(), centered: false)
                                .font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                        }
                    }
                    .chartYAxis {
                        AxisMarks(position: .leading) { v in
                            AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                            AxisValueLabel {
                                if let i = v.as(Int.self) {
                                    Text("\(i)").font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                                }
                            }
                        }
                    }
                    .frame(height: 200)
                }
                .cardStyle()
                .frame(maxWidth: .infinity)

                // New users sparkline
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("New Registrations")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)
                        Text("\(filteredMetrics.map(\.newUsers).reduce(0, +)) users")
                            .font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(DS.textPrimary)
                    }
                    Chart(filteredMetrics) { m in
                        AreaMark(
                            x: .value("Date", m.date, unit: .day),
                            y: .value("Users", m.newUsers)
                        )
                        .foregroundStyle(
                            LinearGradient(colors: [DS.info.opacity(0.5), DS.info.opacity(0.05)],
                                           startPoint: .top, endPoint: .bottom)
                        )
                        LineMark(
                            x: .value("Date", m.date, unit: .day),
                            y: .value("Users", m.newUsers)
                        )
                        .foregroundStyle(DS.info)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                        LineMark(
                            x: .value("Date", m.date, unit: .day),
                            y: .value("Bakers", m.newBakers)
                        )
                        .foregroundStyle(DS.brand)
                        .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    }
                    .chartXAxis {
                        AxisMarks(values: .stride(by: .day, count: chartRange == .sevenDay ? 1 : 7)) { _ in
                            AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                            AxisValueLabel(format: .dateTime.month().day(), centered: false)
                                .font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                        }
                    }
                    .chartYAxis {
                        AxisMarks(position: .leading) { v in
                            AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                            AxisValueLabel {
                                if let i = v.as(Int.self) {
                                    Text("\(i)").font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                                }
                            }
                        }
                    }
                    .frame(height: 200)
                    HStack(spacing: 12) {
                        legendDot(DS.info, "All Users")
                        legendDot(DS.brand, "Bakers")
                    }
                }
                .cardStyle()
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func legendDot(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
        }
    }

    // MARK: - Quick actions

    private var quickActionsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionLabel(text: "Quick Access")
            HStack(spacing: 14) {
                quickTile(icon: "bolt.fill", title: "Ready Now",
                          subtitle: "\(stats.readyNowListings) active listings",
                          color: DS.success, action: { onGoToListings?() })
                quickTile(icon: "person.2.fill", title: "All Users",
                          subtitle: "\(stats.totalBakers) bakers · \(stats.totalBuyers) buyers",
                          color: DS.brand, action: { onGoToUsers?() })
                quickTile(icon: "bubble.left.and.bubble.right.fill", title: "Support Queue",
                          subtitle: "\(stats.openTickets) open tickets",
                          color: stats.openTickets > 3 ? DS.danger : DS.warning,
                          action: { onGoToSupport?() })
                quickTile(icon: "paintbrush.pointed.fill", title: "Commissions",
                          subtitle: "\(stats.customListings) active pipelines",
                          color: DS.gold, action: { onGoToCommissions?() })
            }
        }
    }

    private func quickTile(icon: String, title: String, subtitle: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(color.opacity(0.10))
                        .frame(width: 40, height: 40)
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(color)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(DS.textPrimary)
                    Text(subtitle).font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                }
                Spacer()
                HStack {
                    Spacer()
                    Image(systemName: "arrow.right").font(.system(size: 11, weight: .medium)).foregroundStyle(color)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 130)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(DS.cardBorder, lineWidth: 1))
            .shadow(color: .black.opacity(0.04), radius: 8, x: 0, y: 2)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private func formatCurrency(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "CAD"
        f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "$0"
    }

    // MARK: - Types

    enum ChartRange { case sevenDay, thirtyDay }
}

//
//  AnalyticsView.swift
//  Bakeri Admin
//
//  Full-width analytics with extended time-series and financial breakdown.
//

import SwiftUI
import Charts

struct AnalyticsView: View {
    var onNavigateToUser: ((UUID) -> Void)? = nil

    @State private var metrics:       [DailyMetric]       = []
    @State private var bakerSummary:  [BakerOrderSummary] = []
    @State private var isLoading      = true
    @State private var selectedRange: RangeOption = .thirtyDay
    @State private var customStart:   Date = Calendar.current.date(byAdding: .day, value: -30, to: Date())!
    @State private var customEnd:     Date = Date()

    // Fetched once, wide enough to cover every preset (including 1 Year) —
    // ranges below just slice this client-side instead of re-hitting the RPC.
    private static let fetchWindowDays = 400

    private var filtered: [DailyMetric] {
        let calendar = Calendar.current
        switch selectedRange {
        case .sevenDay:    return Array(metrics.suffix(7))
        case .thirtyDay:   return Array(metrics.suffix(30))
        case .ninetyDay:   return Array(metrics.suffix(90))
        case .yearToDate:
            let startOfYear = calendar.date(from: calendar.dateComponents([.year], from: Date())) ?? Date()
            return metrics.filter { $0.date >= startOfYear }
        case .oneYear:
            return Array(metrics.suffix(365))
        case .custom:
            let start = calendar.startOfDay(for: min(customStart, customEnd))
            let end   = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: max(customStart, customEnd))) ?? customEnd
            return metrics.filter { $0.date >= start && $0.date < end }
        }
    }

    // Wider ranges need sparser axis gridlines or labels overlap.
    private var xAxisStrideDays: Int {
        let n = filtered.count
        if n <= 10  { return 1 }
        if n <= 45  { return 3 }
        if n <= 100 { return 7 }
        if n <= 200 { return 14 }
        return 30
    }

    private var totalGTV:      Double { filtered.map(\.gtv).reduce(0, +) }
    private var totalRevenue:  Double { filtered.map(\.revenue).reduce(0, +) }
    private var totalOrders:   Int    { filtered.map(\.orders).reduce(0, +) }
    private var totalNewUsers: Int    { filtered.map(\.newUsers).reduce(0, +) }
    private var avgDailyGTV:   Double { filtered.isEmpty ? 0 : totalGTV / Double(filtered.count) }
    private var peakDay:       DailyMetric? { filtered.max(by: { $0.gtv < $1.gtv }) }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            if isLoading {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Loading analytics…")
                        .font(.system(size: 13)).foregroundStyle(DS.textSecondary)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        header
                        platformPotentialSection
                        Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                        summaryStrip
                        Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                        gtvSection
                        Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                        revenueAndOrdersRow
                        Divider().foregroundStyle(DS.cardBorder.opacity(0.7))
                        registrationSection
                    }
                    .padding(32)
                }
            }
        }
        .task {
            async let m = SupabaseAdminService.shared.fetchDailyMetrics(days: Self.fetchWindowDays)
            async let b = SupabaseAdminService.shared.fetchPlatformSummary()
            metrics      = (try? await m) ?? []
            bakerSummary = (try? await b) ?? []
            isLoading    = false
        }
    }

    // MARK: - Platform potential (all-time, all orders)

    private var allTimeGTV:     Double { bakerSummary.map(\.totalGTV).reduce(0, +) }
    private var allTimePaid:    Double { bakerSummary.map(\.paidGTV).reduce(0, +)  }
    private var allTimeOrders:  Int    { bakerSummary.map(\.orderCount).reduce(0, +) }

    private var platformPotentialSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(text: "Platform Potential — All Time")
                Text("Every order bakers have run through the app, regardless of how payment was collected. The 5% column shows what platform revenue would have been if all went through Bakeri Payments.")
                    .font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            // Top-line tiles
            HStack(spacing: 14) {
                summaryTile("All-Time GTV",      value: fmt(allTimeGTV),           sub: "total order value",        color: DS.brand)
                summaryTile("Potential Revenue", value: fmt(allTimeGTV * 0.05),    sub: "5% if all paid via Bakeri", color: DS.gold)
                summaryTile("Captured Revenue",  value: fmt(allTimePaid * 0.05),   sub: "from payment-flow orders",  color: DS.success)
                summaryTile("Total Orders",      value: "\(allTimeOrders)",         sub: "across all bakers",        color: DS.info)
            }

            // Per-baker breakdown table
            if !bakerSummary.isEmpty {
                VStack(spacing: 0) {
                    // Header row
                    HStack(spacing: 0) {
                        Text("BAKER").font(.system(size: 9, weight: .bold)).tracking(0.6)
                            .foregroundStyle(DS.textTertiary).frame(maxWidth: .infinity, alignment: .leading)
                        Text("ORDERS").font(.system(size: 9, weight: .bold)).tracking(0.6)
                            .foregroundStyle(DS.textTertiary).frame(width: 64, alignment: .trailing)
                        Text("ORDER VALUE").font(.system(size: 9, weight: .bold)).tracking(0.6)
                            .foregroundStyle(DS.textTertiary).frame(width: 110, alignment: .trailing)
                        Text("PAID THROUGH APP").font(.system(size: 9, weight: .bold)).tracking(0.6)
                            .foregroundStyle(DS.textTertiary).frame(width: 120, alignment: .trailing)
                        Text("POTENTIAL 5%").font(.system(size: 9, weight: .bold)).tracking(0.6)
                            .foregroundStyle(DS.textTertiary).frame(width: 100, alignment: .trailing)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(DS.pageBg)

                    Divider()

                    ForEach(bakerSummary) { baker in
                        Button {
                            onNavigateToUser?(baker.id)
                        } label: {
                            HStack(spacing: 0) {
                                HStack(spacing: 5) {
                                    Text(baker.name)
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(DS.textPrimary)
                                        .lineLimit(1)
                                    if onNavigateToUser != nil {
                                        Image(systemName: "arrow.right")
                                            .font(.system(size: 9, weight: .semibold))
                                            .foregroundStyle(DS.textTertiary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text("\(baker.orderCount)")
                                    .font(.system(size: 13, design: .monospaced))
                                    .foregroundStyle(DS.textSecondary)
                                    .frame(width: 64, alignment: .trailing)
                                Text(fmt(baker.totalGTV))
                                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(DS.textPrimary)
                                    .frame(width: 110, alignment: .trailing)
                                Text(fmt(baker.paidGTV))
                                    .font(.system(size: 13, design: .monospaced))
                                    .foregroundStyle(baker.paidGTV > 0 ? DS.success : DS.textTertiary)
                                    .frame(width: 120, alignment: .trailing)
                                Text(fmt(baker.potentialRevenue))
                                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(DS.gold)
                                    .frame(width: 100, alignment: .trailing)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        Divider().padding(.leading, 16)
                    }

                    // Totals footer
                    HStack(spacing: 0) {
                        Text("TOTAL").font(.system(size: 10, weight: .bold)).tracking(0.4)
                            .foregroundStyle(DS.textSecondary).frame(maxWidth: .infinity, alignment: .leading)
                        Text("\(allTimeOrders)")
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(DS.textSecondary).frame(width: 64, alignment: .trailing)
                        Text(fmt(allTimeGTV))
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(DS.textPrimary).frame(width: 110, alignment: .trailing)
                        Text(fmt(allTimePaid))
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(DS.success).frame(width: 120, alignment: .trailing)
                        Text(fmt(allTimeGTV * 0.05))
                            .font(.system(size: 12, weight: .bold, design: .monospaced))
                            .foregroundStyle(DS.gold).frame(width: 100, alignment: .trailing)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(DS.pageBg.opacity(0.6))
                }
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(DS.cardBorder))
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .trailing, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Analytics").font(.system(size: 30, weight: .bold)).foregroundStyle(DS.textPrimary)
                    Text("Financial telemetry and growth metrics").font(.system(size: 13)).foregroundStyle(DS.textSecondary)
                }
                Spacer()
                Picker("Range", selection: $selectedRange) {
                    Text("7D").tag(RangeOption.sevenDay)
                    Text("30D").tag(RangeOption.thirtyDay)
                    Text("90D").tag(RangeOption.ninetyDay)
                    Text("YTD").tag(RangeOption.yearToDate)
                    Text("1Y").tag(RangeOption.oneYear)
                    Text("Custom").tag(RangeOption.custom)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 380)
            }

            if selectedRange == .custom {
                HStack(spacing: 10) {
                    DatePicker("From", selection: $customStart, in: ...customEnd, displayedComponents: .date)
                        .labelsHidden()
                    Text("–").foregroundStyle(DS.textTertiary)
                    DatePicker("To", selection: $customEnd, in: customStart...Date(), displayedComponents: .date)
                        .labelsHidden()
                    Text("\(filtered.count) day\(filtered.count == 1 ? "" : "s") selected")
                        .font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                }
            }
        }
    }

    // MARK: - Summary strip

    private var summaryStrip: some View {
        HStack(spacing: 14) {
            summaryTile("GTV", value: fmt(totalGTV), sub: "gross transaction volume", color: DS.brand)
            summaryTile("Revenue", value: fmt(totalRevenue), sub: "5% platform fee", color: DS.gold)
            summaryTile("Orders", value: "\(totalOrders)", sub: "marketplace transactions", color: DS.info)
            summaryTile("New Users", value: "\(totalNewUsers)", sub: "registrations", color: DS.gold)
            summaryTile("Avg Daily GTV", value: fmt(avgDailyGTV), sub: "per day", color: DS.brand.opacity(0.7))
        }
    }

    private func summaryTile(_ label: String, value: String, sub: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .bold)).tracking(0.8).foregroundStyle(DS.textTertiary)
            Text(value)
                .font(.system(size: 24, weight: .bold, design: .rounded)).foregroundStyle(DS.textPrimary)
            Text(sub).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
            Rectangle().fill(color).frame(height: 3).clipShape(Capsule())
        }
        .cardStyle()
        .frame(maxWidth: .infinity)
    }

    // MARK: - GTV chart

    private var gtvSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(text: "Gross Transaction Volume")
                if let peak = peakDay {
                    Text("Peak day: \(fmtDate(peak.date)) — \(fmt(peak.gtv))")
                        .font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                }
            }
            Chart(filtered) { m in
                LineMark(x: .value("Date", m.date, unit: .day), y: .value("GTV", m.gtv))
                    .foregroundStyle(DS.brand)
                    .lineStyle(StrokeStyle(lineWidth: 2.5))
                AreaMark(x: .value("Date", m.date, unit: .day), y: .value("GTV", m.gtv))
                    .foregroundStyle(LinearGradient(
                        colors: [DS.brand.opacity(0.22), DS.brand.opacity(0.0)],
                        startPoint: .top, endPoint: .bottom))
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: xAxisStrideDays)) {
                    AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                    AxisValueLabel(format: .dateTime.month().day())
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
            .frame(height: 240)
            .cardStyle()
        }
    }

    // MARK: - Revenue + orders row

    private var revenueAndOrdersRow: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(text: "Platform Revenue (5% Fee)")
                Chart(filtered) { m in
                    BarMark(x: .value("Date", m.date, unit: .day), y: .value("Revenue", m.revenue))
                        .foregroundStyle(LinearGradient(
                            colors: [DS.gold, DS.gold.opacity(0.5)],
                            startPoint: .top, endPoint: .bottom))
                        .cornerRadius(3)
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: xAxisStrideDays)) {
                        AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                        AxisValueLabel(format: .dateTime.month().day())
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

            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(text: "Daily Order Count")
                Chart(filtered) { m in
                    BarMark(x: .value("Date", m.date, unit: .day), y: .value("Orders", m.orders))
                        .foregroundStyle(LinearGradient(
                            colors: [DS.info, DS.info.opacity(0.5)],
                            startPoint: .top, endPoint: .bottom))
                        .cornerRadius(3)
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: xAxisStrideDays)) {
                        AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                        AxisValueLabel(format: .dateTime.month().day())
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
        }
    }

    // MARK: - Registration chart

    private var registrationSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "User Registrations")
            Chart(filtered) { m in
                AreaMark(x: .value("Date", m.date, unit: .day), y: .value("Total", m.newUsers))
                    .foregroundStyle(LinearGradient(
                        colors: [DS.gold.opacity(0.3), DS.gold.opacity(0.0)],
                        startPoint: .top, endPoint: .bottom))
                LineMark(x: .value("Date", m.date, unit: .day), y: .value("Total", m.newUsers))
                    .foregroundStyle(DS.gold).lineStyle(StrokeStyle(lineWidth: 2.5))
                LineMark(x: .value("Date", m.date, unit: .day), y: .value("Bakers", m.newBakers))
                    .foregroundStyle(DS.brand).lineStyle(StrokeStyle(lineWidth: 2, dash: [5, 3]))
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day, count: xAxisStrideDays)) {
                    AxisGridLine().foregroundStyle(DS.cardBorder.opacity(0.5))
                    AxisValueLabel(format: .dateTime.month().day())
                        .font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                }
            }
            .frame(height: 180)
            .cardStyle()
        }
    }

    // MARK: - Helpers

    private func fmt(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency; f.currencyCode = "CAD"; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "$0"
    }

    private func fmtDate(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MMM d"
        return f.string(from: d)
    }

    enum RangeOption { case sevenDay, thirtyDay, ninetyDay, yearToDate, oneYear, custom }
}

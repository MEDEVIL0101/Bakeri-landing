//
//  PreOrderView.swift
//  Bakeri Admin
//
//  Module 2b — Pre-Orders Registry.
//  Time-horizon tracking for upcoming batches, fulfillment deadlines, and fill-rate meters.
//

import SwiftUI

struct PreOrderView: View {
    @State private var batches: [PreOrderBatch] = []
    @State private var isLoading    = true
    @State private var searchText   = ""
    @State private var sortField: SortField = .deadline
    @State private var sortAscending = true

    private var filtered: [PreOrderBatch] {
        var r = batches
        if !searchText.isEmpty {
            r = r.filter {
                $0.name.localizedCaseInsensitiveContains(searchText) ||
                $0.bakerName.localizedCaseInsensitiveContains(searchText)
            }
        }
        r.sort {
            switch sortField {
            case .name:     return sortAscending ? $0.name < $1.name : $0.name > $1.name
            case .baker:    return sortAscending ? $0.bakerName < $1.bakerName : $0.bakerName > $1.bakerName
            case .deadline: return sortAscending ? $0.deliveryDate < $1.deliveryDate : $0.deliveryDate > $1.deliveryDate
            case .fill:     return sortAscending ? $0.fillPct < $1.fillPct : $0.fillPct > $1.fillPct
            }
        }
        return r
    }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            VStack(spacing: 0) {
                toolbarArea
                Divider()
                if isLoading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else if batches.isEmpty {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.system(size: 36)).foregroundStyle(DS.textTertiary)
                        Text("No pre-order listings")
                            .font(.system(size: 15, weight: .medium)).foregroundStyle(DS.textSecondary)
                        Text("Pre-order batches created by bakers will appear here.")
                            .font(.system(size: 12)).foregroundStyle(DS.textTertiary)
                            .multilineTextAlignment(.center).padding(.horizontal, 40)
                    }
                    Spacer()
                } else {
                    columnHeader
                    Divider()
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(filtered) { batch in
                                batchRow(batch)
                                Divider().padding(.leading, 16)
                            }
                        }
                    }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        let real = (try? await SupabaseAdminService.shared.fetchPreOrderBatches()) ?? []
        batches   = real.isEmpty ? Array(MockData.preOrderBatches.prefix(3)) : real
        isLoading = false
    }

    // MARK: - Toolbar

    private var toolbarArea: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pre-Orders").font(.system(size: 18, weight: .bold)).foregroundStyle(DS.textPrimary)
                    Text("\(filtered.count) batches · \(filtered.map(\.orderedQty).reduce(0,+)) slots filled")
                        .font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                }
                Spacer()
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(DS.textTertiary)
                TextField("Search batches…", text: $searchText)
                    .font(.system(size: 13)).textFieldStyle(.plain)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
            .padding(.horizontal, 20).padding(.bottom, 12)
        }
        .background(DS.cardBg)
    }

    // MARK: - Column header

    private var columnHeader: some View {
        HStack(spacing: 0) {
            sortHeader("Batch Name", .name, flex: true)
            sortHeader("Baker", .baker, width: 130)
            sortHeader("Cutoff", nil, width: 90)
            sortHeader("Delivery", .deadline, width: 90)
            sortHeader("Fill Rate", .fill, width: 130)
            Text("Price From").font(.system(size: 10, weight: .semibold)).tracking(0.4)
                .foregroundStyle(DS.textTertiary).frame(width: 90, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(DS.pageBg)
    }

    private func sortHeader(_ label: String, _ field: SortField?, width: CGFloat? = nil, flex: Bool = false) -> some View {
        let isActive = field != nil && sortField == field
        return Button {
            if let f = field {
                if sortField == f { sortAscending.toggle() }
                else { sortField = f; sortAscending = true }
            }
        } label: {
            HStack(spacing: 3) {
                Text(label).font(.system(size: 10, weight: .semibold)).tracking(0.4)
                    .foregroundStyle(isActive ? DS.brand : DS.textTertiary)
                if isActive {
                    Image(systemName: sortAscending ? "chevron.up" : "chevron.down")
                        .font(.system(size: 8, weight: .bold)).foregroundStyle(DS.brand)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(width: width, alignment: .leading)
        .frame(maxWidth: flex ? .infinity : nil, alignment: .leading)
    }

    // MARK: - Batch row

    private func batchRow(_ batch: PreOrderBatch) -> some View {
        HStack(spacing: 0) {
            // Name + category
            VStack(alignment: .leading, spacing: 2) {
                Text(batch.name).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.textPrimary)
                Text(batch.category).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Baker
            HStack(spacing: 6) {
                InitialsAvatar(name: batch.bakerName, size: 20, cornerRadius: 5, color: DS.brand)
                Text(batch.bakerName).font(.system(size: 12)).foregroundStyle(DS.textSecondary).lineLimit(1)
            }
            .frame(width: 130, alignment: .leading)

            // Cutoff
            VStack(alignment: .leading, spacing: 1) {
                Text(fmtShort(batch.cutoffDate)).font(.system(size: 12, weight: .medium)).foregroundStyle(daysUntilColor(batch.cutoffDate))
                Text(daysLabel(batch.cutoffDate)).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
            }
            .frame(width: 90, alignment: .leading)

            // Delivery
            VStack(alignment: .leading, spacing: 1) {
                Text(fmtShort(batch.deliveryDate)).font(.system(size: 12, weight: .medium)).foregroundStyle(DS.textPrimary)
                Text(daysLabel(batch.deliveryDate)).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
            }
            .frame(width: 90, alignment: .leading)

            // Fill rate meter
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text("\(batch.orderedQty)/\(batch.totalBatchQty)")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .foregroundStyle(DS.textPrimary)
                    Text("(\(Int(batch.fillPct * 100))%)")
                        .font(.system(size: 10)).foregroundStyle(DS.textSecondary)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3).fill(DS.cardBorder).frame(height: 6)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(fillColor(batch.fillPct))
                            .frame(width: max(4, geo.size.width * CGFloat(batch.fillPct)), height: 6)
                    }
                }
                .frame(height: 6)
            }
            .frame(width: 130, alignment: .leading)

            // Price
            Text("from $\(String(format: "%.0f", batch.priceFrom))")
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(DS.textPrimary)
                .frame(width: 90, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Color.clear)
        .contentShape(Rectangle())
    }

    // MARK: - Helpers

    private func fillColor(_ pct: Double) -> Color {
        if pct >= 1.0 { return DS.danger }
        if pct >= 0.8 { return DS.warning }
        return DS.success
    }

    private func fmtShort(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MMM d"; return f.string(from: d)
    }

    private func daysLabel(_ d: Date) -> String {
        let diff = Calendar.current.dateComponents([.day], from: Date(), to: d).day ?? 0
        if diff < 0  { return "overdue" }
        if diff == 0 { return "today" }
        return "in \(diff)d"
    }

    private func daysUntilColor(_ d: Date) -> Color {
        let diff = Calendar.current.dateComponents([.day], from: Date(), to: d).day ?? 0
        if diff <= 1 { return DS.danger }
        if diff <= 3 { return DS.warning }
        return DS.textPrimary
    }

    enum SortField { case name, baker, deadline, fill }
}

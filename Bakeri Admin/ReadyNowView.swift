//
//  ReadyNowView.swift
//  Bakeri Admin
//
//  Module 2a — "Ready Now" Ledger.
//  Real-time on-demand inventory: sortable, filterable master table.
//  Admins can pull down (deactivate) or reactivate any listing from the ⋯ menu.
//

import SwiftUI

struct ReadyNowView: View {
    var onNavigateToUser: ((UUID) -> Void)? = nil

    @State private var listings: [MarketplaceListing] = MockData.readyNowListings
    @State private var searchText = ""
    @State private var sortField: SortField = .name
    @State private var sortAscending = true
    @State private var selectedCategory: String = "All"
    @State private var isLoading = false
    @State private var selectedListing: MarketplaceListing?
    @State private var listingToToggle: MarketplaceListing?
    @State private var isToggling = false

    private let categories = ["All", "Viennoiserie", "Confectionery", "Pastry", "Bread", "Japanese", "Indian Sweets", "West African"]

    private var filtered: [MarketplaceListing] {
        var result = listings
        if selectedCategory != "All" { result = result.filter { $0.category == selectedCategory } }
        if !searchText.isEmpty {
            result = result.filter {
                $0.name.localizedCaseInsensitiveContains(searchText) ||
                $0.bakerName.localizedCaseInsensitiveContains(searchText) ||
                $0.bakeryName.localizedCaseInsensitiveContains(searchText)
            }
        }
        result.sort {
            switch sortField {
            case .name:     return sortAscending ? $0.name < $1.name : $0.name > $1.name
            case .baker:    return sortAscending ? $0.bakerName < $1.bakerName : $0.bakerName > $1.bakerName
            case .price:    return sortAscending ? $0.displayPrice < $1.displayPrice : $0.displayPrice > $1.displayPrice
            case .stock:    return sortAscending ? $0.available_qty_today < $1.available_qty_today : $0.available_qty_today > $1.available_qty_today
            }
        }
        return result
    }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            VStack(spacing: 0) {
                toolbarArea
                Divider()
                if filtered.isEmpty {
                    emptyState
                } else {
                    listArea
                }
            }
        }
        .task { await load() }
        .alert(
            listingToToggle?.is_active == true ? "Pull Down Listing?" : "Reactivate Listing?",
            isPresented: Binding(get: { listingToToggle != nil }, set: { if !$0 { listingToToggle = nil } })
        ) {
            Button("Cancel", role: .cancel) { listingToToggle = nil }
            Button(
                listingToToggle?.is_active == true ? "Pull Down" : "Reactivate",
                role: listingToToggle?.is_active == true ? .destructive : nil
            ) {
                Task { await performToggle() }
            }
        } message: {
            if let l = listingToToggle {
                Text(l.is_active
                    ? "\(l.name) will be hidden from the marketplace immediately."
                    : "\(l.name) will go live on the marketplace again.")
            }
        }
    }

    // MARK: - Toolbar

    private var toolbarArea: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ready Now").font(.system(size: 18, weight: .bold)).foregroundStyle(DS.textPrimary)
                    Text("\(filtered.count) listings").font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                }
                Spacer()
                if isLoading { ProgressView().scaleEffect(0.7) }
                Button { Task { await load() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .medium))
                        .foregroundStyle(DS.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)

            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(DS.textTertiary)
                    TextField("Search listings…", text: $searchText)
                        .font(.system(size: 13))
                        .textFieldStyle(.plain)
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
                .frame(maxWidth: 200)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(categories, id: \.self) { cat in
                            categoryChip(cat)
                        }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 12)
        }
        .background(DS.cardBg)
    }

    private func categoryChip(_ cat: String) -> some View {
        let selected = selectedCategory == cat
        return Button { selectedCategory = cat } label: {
            Text(cat)
                .font(.system(size: 11, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? DS.brand : DS.textSecondary)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(selected ? DS.brand.opacity(0.10) : DS.pageBg)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(selected ? DS.brand.opacity(0.4) : DS.cardBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Column header

    private var columnHeader: some View {
        HStack(spacing: 0) {
            sortHeader("Listing", .name, flex: true)
            sortHeader("Baker", .baker, width: 140)
            sortHeader("Category", nil, width: 120)
            sortHeader("Location", nil, width: 110)
            sortHeader("Price", .price, width: 80)
            sortHeader("Stock", .stock, width: 70)
            Text("Status").font(.system(size: 10, weight: .semibold)).tracking(0.4)
                .foregroundStyle(DS.textTertiary).frame(width: 90, alignment: .leading)
            Text("").frame(width: 44)
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

    // MARK: - List

    private var listArea: some View {
        VStack(spacing: 0) {
            columnHeader
            Divider()
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(filtered) { listing in
                        listingRow(listing)
                        Divider().padding(.leading, 16)
                    }
                }
            }
        }
    }

    private func listingRow(_ listing: MarketplaceListing) -> some View {
        let isSelected = selectedListing?.id == listing.id
        return HStack(spacing: 0) {
            // Name + description
            VStack(alignment: .leading, spacing: 2) {
                Text(listing.name).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.textPrimary)
                Text(listing.item_description)
                    .font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Baker — tappable link if navigation is wired
            HStack(spacing: 6) {
                InitialsAvatar(name: listing.bakerName, size: 22, cornerRadius: 5, color: DS.brand)
                if let navigate = onNavigateToUser {
                    Button {
                        navigate(listing.user_id)
                    } label: {
                        Text(listing.bakeryName)
                            .font(.system(size: 12))
                            .foregroundStyle(DS.brand)
                            .underline()
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(listing.bakeryName)
                        .font(.system(size: 12))
                        .foregroundStyle(DS.textSecondary)
                        .lineLimit(1)
                }
            }
            .frame(width: 140, alignment: .leading)

            // Category
            Text(listing.category).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                .frame(width: 120, alignment: .leading)

            // Location
            Text(listing.bakerLocation).font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                .frame(width: 110, alignment: .leading)

            // Price
            Text("$\(String(format: "%.2f", listing.displayPrice))")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(DS.textPrimary)
                .frame(width: 80, alignment: .leading)

            // Stock
            stockIndicator(listing.available_qty_today).frame(width: 70, alignment: .leading)

            // Status pill
            statusPill(listing.is_active).frame(width: 90, alignment: .leading)

            // Actions menu
            Menu {
                if listing.is_active {
                    Button(role: .destructive) {
                        listingToToggle = listing
                    } label: {
                        Label("Pull Down Listing", systemImage: "pause.circle.fill")
                    }
                } else {
                    Button {
                        listingToToggle = listing
                    } label: {
                        Label("Reactivate Listing", systemImage: "play.circle.fill")
                    }
                }
                if onNavigateToUser != nil {
                    Divider()
                    Button {
                        onNavigateToUser?(listing.user_id)
                    } label: {
                        Label("View Baker Profile", systemImage: "person.circle")
                    }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(isToggling ? DS.textTertiary.opacity(0.4) : DS.textTertiary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .frame(width: 44, alignment: .center)
            .disabled(isToggling)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(isSelected ? DS.brand.opacity(0.05) : Color.clear)
        .contentShape(Rectangle())
        .onTapGesture { selectedListing = listing }
    }

    private func stockIndicator(_ qty: Int) -> some View {
        let color: Color = qty >= 5 ? DS.success : qty >= 2 ? DS.warning : DS.danger
        return HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text("\(qty)").font(.system(size: 12, weight: .medium, design: .monospaced)).foregroundStyle(color)
        }
    }

    private func statusPill(_ active: Bool) -> some View {
        Text(active ? "Active" : "Paused")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(active ? DS.success : DS.textTertiary)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background((active ? DS.success : DS.textTertiary).opacity(0.1))
            .clipShape(Capsule())
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "bolt.slash").font(.system(size: 40)).foregroundStyle(.tertiary)
            Text("No listings found").font(.title3).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data

    private func load() async {
        isLoading = true
        listings = (try? await SupabaseAdminService.shared.fetchListings(kind: "ready_now")) ?? MockData.readyNowListings
        isLoading = false
    }

    private func performToggle() async {
        guard let l = listingToToggle else { return }
        let newActive = !l.is_active
        listingToToggle = nil
        isToggling = true
        do {
            try await SupabaseAdminService.shared.updateListingStatus(id: l.id, isActive: newActive)
            if let idx = listings.firstIndex(where: { $0.id == l.id }) {
                listings[idx].is_active = newActive
            }
        } catch {
            await load()
        }
        isToggling = false
    }

    enum SortField { case name, baker, price, stock }
}

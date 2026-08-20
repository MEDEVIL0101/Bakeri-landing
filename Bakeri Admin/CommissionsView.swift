//
//  CommissionsView.swift
//  Bakeri Admin
//
//  Custom Orders — bespoke/commission-style marketplace listings.
//  Live data from menu_items where listing_kind = 'custom'.
//

import SwiftUI

struct CommissionsView: View {
    @State private var listings: [MarketplaceListing] = []
    @State private var searchText = ""
    @State private var isLoading = false
    @State private var selectedListing: MarketplaceListing?

    private var filtered: [MarketplaceListing] {
        guard !searchText.isEmpty else { return listings }
        return listings.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.bakeryName.localizedCaseInsensitiveContains(searchText) ||
            $0.category.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            VStack(spacing: 0) {
                toolbarArea
                Divider()
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filtered.isEmpty {
                    emptyState
                } else {
                    listArea
                }
            }
        }
        .task { await load() }
    }

    // MARK: - Toolbar

    private var toolbarArea: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Custom Orders")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(DS.textPrimary)
                    Text("\(filtered.count) active listings · bespoke & custom bakes")
                        .font(.system(size: 11))
                        .foregroundStyle(DS.textSecondary)
                }
                Spacer()
                if isLoading { ProgressView().scaleEffect(0.7) }
                Button { Task { await load() } } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(DS.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12)).foregroundStyle(DS.textTertiary)
                TextField("Search custom listings…", text: $searchText)
                    .font(.system(size: 13)).textFieldStyle(.plain)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
            .padding(.horizontal, 20).padding(.bottom, 12)
            .frame(maxWidth: 320, alignment: .leading)
        }
        .background(DS.cardBg)
    }

    // MARK: - Column header

    private var columnHeader: some View {
        HStack(spacing: 0) {
            colHead("Listing", flex: true)
            colHead("Baker", width: 150)
            colHead("Category", width: 130)
            colHead("Price From", width: 100)
            colHead("Lead Days", width: 90)
            colHead("Status", width: 90)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(DS.pageBg)
    }

    private func colHead(_ label: String, width: CGFloat? = nil, flex: Bool = false) -> some View {
        Text(label)
            .font(.system(size: 10, weight: .semibold)).tracking(0.4)
            .foregroundStyle(DS.textTertiary)
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
        return Button { selectedListing = listing } label: {
            HStack(spacing: 0) {
                // Listing name + description
                VStack(alignment: .leading, spacing: 2) {
                    Text(listing.name)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(DS.textPrimary)
                    Text(listing.item_description)
                        .font(.system(size: 11))
                        .foregroundStyle(DS.textSecondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Baker
                HStack(spacing: 7) {
                    InitialsAvatar(
                        name: listing.bakeryName.isEmpty ? listing.bakerName : listing.bakeryName,
                        size: 22, cornerRadius: 5, color: DS.gold
                    )
                    Text(listing.bakeryName.isEmpty ? listing.bakerName : listing.bakeryName)
                        .font(.system(size: 12))
                        .foregroundStyle(DS.textSecondary)
                        .lineLimit(1)
                }
                .frame(width: 150, alignment: .leading)

                // Category
                Text(listing.category)
                    .font(.system(size: 11))
                    .foregroundStyle(DS.textSecondary)
                    .frame(width: 130, alignment: .leading)

                // Price from
                Text("$\(String(format: "%.0f", listing.displayPrice))+")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(DS.textPrimary)
                    .frame(width: 100, alignment: .leading)

                // Lead days
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.system(size: 10))
                        .foregroundStyle(DS.textTertiary)
                    Text("\(listing.lead_days)d")
                        .font(.system(size: 12))
                        .foregroundStyle(DS.textSecondary)
                }
                .frame(width: 90, alignment: .leading)

                // Status
                Text(listing.is_active ? "Active" : "Paused")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(listing.is_active ? DS.success : DS.textTertiary)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background((listing.is_active ? DS.success : DS.textTertiary).opacity(0.10))
                    .clipShape(Capsule())
                    .frame(width: 90, alignment: .leading)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(isSelected ? DS.brand.opacity(0.05) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "paintbrush.pointed")
                .font(.system(size: 40)).foregroundStyle(.tertiary)
            Text("No custom listings found")
                .font(.title3).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data

    private func load() async {
        isLoading = true
        listings = (try? await SupabaseAdminService.shared.fetchListings(kind: "custom")) ?? []
        isLoading = false
    }
}

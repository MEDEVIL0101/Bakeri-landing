//
//  UserMapView.swift
//  Bakeri Admin
//
//  Plots users on a map. Three-tier fallback, most-precise first:
//    1. profile.location        — self-reported "City, ST" on their own profile
//    2. vendor_applications     — city/state given on the public "For Bakers"
//                                  form before they had an account (matched by
//                                  real auth email, not profiles.email — that
//                                  column is unmaintained, see fetchAuthEmails)
//    3. registration_events     — IP address captured at signup, resolved to a
//                                  country by Cloudflare (cf-ipcountry). Real
//                                  IP-derived data, country-level only — no
//                                  city/street geolocation service is wired up
//                                  here. Not currently disclosed in a privacy
//                                  policy; kept as a distinctly-labeled tier so
//                                  it's obvious which pins are IP-inferred.
//

import SwiftUI
import MapKit
import CoreLocation

struct UserMapView: View {
    var onNavigateToUser: (UUID) -> Void

    @State private var isLoading = true
    @State private var isGeocoding = false
    @State private var geocodeDone = 0
    @State private var geocodeTotal = 0

    @State private var pins: [LocationPin] = []
    @State private var unresolved: [MappedProfile] = []
    @State private var roleFilter: RoleFilter = .all
    @State private var selectedPinID: String?
    @State private var showUnresolved = false

    @State private var cameraPosition: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 25, longitude: -20),
            span: MKCoordinateSpan(latitudeDelta: 110, longitudeDelta: 150)
        )
    )

    // In-memory only — re-geocoding on every app launch is fine at this user count.
    @State private static var geocodeCache: [String: CLLocationCoordinate2D] = [:]

    enum RoleFilter: String, CaseIterable { case all = "All", bakers = "Bakers", buyers = "Buyers" }

    enum LocationSource: Equatable {
        case profile, application, ipCountry

        var badgeLabel: String? {
            switch self {
            case .profile:     return nil
            case .application: return "via application"
            case .ipCountry:   return "via IP · country-level"
            }
        }
        var badgeColor: Color {
            switch self {
            case .profile:     return DS.textTertiary
            case .application: return DS.gold
            case .ipCountry:   return DS.danger
            }
        }
    }

    // A profile plus where its map location came from and, for IP-derived
    // rows, the raw IP that resolved to it (kept for admin reference only —
    // never shown on the map itself, just in the per-user detail row).
    struct MappedProfile: Identifiable {
        let profile: BakeriProfile
        var source: LocationSource = .profile
        var ipAddress: String? = nil

        var id: UUID { profile.id }
        var isBaker: Bool { profile.isBaker }
        var user_name: String? { profile.user_name }
        var email: String? { profile.email }
        var business_name: String? { profile.business_name }
    }

    struct LocationPin: Identifiable {
        let id: String          // normalized location string
        let coordinate: CLLocationCoordinate2D
        let label: String
        var profiles: [MappedProfile]

        var bakerCount: Int { profiles.filter(\.isBaker).count }
        var buyerCount: Int { profiles.count - bakerCount }
        var dominantColor: Color {
            if bakerCount > 0 && buyerCount == 0 { return DS.brand }
            if buyerCount > 0 && bakerCount == 0 { return DS.info }
            return DS.gold
        }
    }

    private var filteredPins: [LocationPin] {
        pins.compactMap { pin in
            let subset: [MappedProfile]
            switch roleFilter {
            case .all:    subset = pin.profiles
            case .bakers: subset = pin.profiles.filter(\.isBaker)
            case .buyers: subset = pin.profiles.filter { !$0.isBaker }
            }
            guard !subset.isEmpty else { return nil }
            var p = pin
            p.profiles = subset
            return p
        }
    }

    private var mappedUserCount: Int { pins.reduce(0) { $0 + $1.profiles.count } }
    private var totalUserCount: Int { mappedUserCount + unresolved.count }
    private var ipDerivedCount: Int {
        pins.reduce(0) { $0 + $1.profiles.filter { $0.source == .ipCountry }.count }
    }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            if isLoading {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Loading users…").font(.system(size: 13)).foregroundStyle(DS.textSecondary)
                }
            } else {
                VStack(spacing: 0) {
                    header
                    Divider().foregroundStyle(DS.cardBorder)
                    mapArea
                    if !unresolved.isEmpty {
                        Divider().foregroundStyle(DS.cardBorder)
                        unresolvedBar
                    }
                }
            }
        }
        .task { await load() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("User Map").font(.system(size: 30, weight: .bold)).foregroundStyle(DS.textPrimary)
                Text("Profile location, then vendor-application city/state, then IP-derived country as a last resort. IP-derived pins aren't yet covered by a privacy policy disclosure — treat as internal-only until that's addressed.")
                    .font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 14) {
                    legendDot(color: DS.brand, label: "Bakers")
                    legendDot(color: DS.info, label: "Buyers")
                    legendDot(color: DS.gold, label: "Mixed")
                    if isGeocoding {
                        HStack(spacing: 5) {
                            ProgressView().controlSize(.small)
                            Text("Locating \(geocodeDone)/\(geocodeTotal)…")
                                .font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                        }
                    } else {
                        Text("\(mappedUserCount) of \(totalUserCount) users mapped")
                            .font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                        if ipDerivedCount > 0 {
                            Text("· \(ipDerivedCount) via IP only")
                                .font(.system(size: 11, weight: .medium)).foregroundStyle(DS.danger)
                        }
                    }
                }
                .padding(.top, 4)
            }
            Spacer()
            Picker("Role", selection: $roleFilter) {
                ForEach(RoleFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 220)
        }
        .padding(24)
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
        }
    }

    // MARK: - Map

    private var mapArea: some View {
        Map(position: $cameraPosition) {
            ForEach(filteredPins) { pin in
                Annotation(pin.label, coordinate: pin.coordinate) {
                    pinView(pin)
                }
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func pinSize(for count: Int) -> CGFloat {
        min(46, 22 + CGFloat(sqrt(Double(count - 1))) * 8)
    }

    private func pinView(_ pin: LocationPin) -> some View {
        let size = pinSize(for: pin.profiles.count)
        return Button {
            selectedPinID = pin.id
        } label: {
            ZStack {
                Circle()
                    .fill(pin.dominantColor)
                    .frame(width: size, height: size)
                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                    .shadow(color: .black.opacity(0.25), radius: 3, y: 1)
                Text("\(pin.profiles.count)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .buttonStyle(.plain)
        .popover(isPresented: Binding(
            get: { selectedPinID == pin.id },
            set: { if !$0 { selectedPinID = nil } }
        )) {
            pinDetailPopover(pin)
        }
    }

    private func pinDetailPopover(_ pin: LocationPin) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(pin.label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DS.textPrimary)
            Text("\(pin.profiles.count) user\(pin.profiles.count == 1 ? "" : "s")")
                .font(.system(size: 11)).foregroundStyle(DS.textTertiary)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(pin.profiles) { mapped in
                        Button {
                            selectedPinID = nil
                            onNavigateToUser(mapped.id)
                        } label: {
                            HStack(spacing: 8) {
                                InitialsAvatar(name: mapped.user_name ?? mapped.email ?? "?", size: 26)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(mapped.user_name ?? mapped.email ?? "Unknown")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(DS.textPrimary)
                                        .lineLimit(1)
                                    HStack(spacing: 4) {
                                        if let biz = mapped.business_name, !biz.isEmpty {
                                            Text(biz).font(.system(size: 10)).foregroundStyle(DS.textTertiary).lineLimit(1)
                                        }
                                        if let badge = mapped.source.badgeLabel {
                                            Text(badge)
                                                .font(.system(size: 9, weight: .medium))
                                                .foregroundStyle(mapped.source.badgeColor)
                                        }
                                    }
                                    if let ip = mapped.ipAddress {
                                        Text(ip)
                                            .font(.system(size: 9, design: .monospaced))
                                            .foregroundStyle(DS.textTertiary)
                                    }
                                }
                                Spacer()
                                RoleBadge(isBaker: mapped.isBaker)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxHeight: 220)
        }
        .padding(14)
        .frame(width: 260)
    }

    // MARK: - Unresolved bar

    private var unresolvedBar: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) { showUnresolved.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: showUnresolved ? "chevron.down" : "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                    Text("\(unresolved.count) user\(unresolved.count == 1 ? "" : "s") without a mappable location")
                        .font(.system(size: 12, weight: .medium))
                }
                .foregroundStyle(DS.textSecondary)
                .padding(.horizontal, 24)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if showUnresolved {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(unresolved) { mapped in
                            Button {
                                onNavigateToUser(mapped.id)
                            } label: {
                                HStack(spacing: 6) {
                                    Text(mapped.user_name ?? mapped.email ?? "Unknown")
                                        .font(.system(size: 11, weight: .medium))
                                    RoleBadge(isBaker: mapped.isBaker)
                                }
                                .foregroundStyle(DS.textPrimary)
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(DS.cardBg)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 14)
                }
            }
        }
        .background(DS.pageBg)
    }

    // MARK: - Load + geocode

    private func load() async {
        async let profilesFetch = SupabaseAdminService.shared.fetchProfiles()
        async let applicationsFetch = SupabaseAdminService.shared.fetchVendorApplicationLocations()
        async let authUsersFetch = SupabaseAdminService.shared.fetchAuthUsers()
        async let registrationFetch = SupabaseAdminService.shared.fetchRegistrationEvents()

        let profiles = (try? await profilesFetch) ?? []
        let applicationLocations = (try? await applicationsFetch) ?? [:]
        let authUsers = (try? await authUsersFetch) ?? []
        let registrationEvents = (try? await registrationFetch) ?? [:]

        // profiles.email is unmaintained (app reads email from auth.session,
        // not profiles — see 20260601000003_profiles_column_security.sql),
        // so the application-form join has to go through the real auth email.
        let authEmailByID = Dictionary(uniqueKeysWithValues: authUsers.compactMap { u -> (UUID, String)? in
            guard let email = u.email else { return nil }
            return (u.id, email.lowercased())
        })

        struct Resolved { let profile: BakeriProfile; let label: String?; let source: LocationSource; let ip: String? }

        var resolved: [Resolved] = []
        for profile in profiles {
            let ownLocation = (profile.location ?? "").trimmingCharacters(in: .whitespaces)
            if !ownLocation.isEmpty {
                resolved.append(Resolved(profile: profile, label: ownLocation, source: .profile, ip: nil))
                continue
            }
            if let email = authEmailByID[profile.id],
               let appLocation = applicationLocations[email]?.displayLocation {
                resolved.append(Resolved(profile: profile, label: appLocation, source: .application, ip: nil))
                continue
            }
            if let event = registrationEvents[profile.id], let country = event.countryName {
                resolved.append(Resolved(profile: profile, label: country, source: .ipCountry, ip: event.ip_address))
                continue
            }
            resolved.append(Resolved(profile: profile, label: nil, source: .profile, ip: nil))
        }

        let grouped = Dictionary(grouping: resolved.filter { $0.label != nil }) { $0.label! }
        var missing = resolved.filter { $0.label == nil }.map { MappedProfile(profile: $0.profile) }

        isLoading = false
        isGeocoding = true
        geocodeTotal = grouped.count
        geocodeDone = 0

        var resolvedPins: [LocationPin] = []
        for (label, group) in grouped {
            let mappedGroup = group.map { MappedProfile(profile: $0.profile, source: $0.source, ipAddress: $0.ip) }
            if let cached = Self.geocodeCache[label] {
                resolvedPins.append(LocationPin(id: label, coordinate: cached, label: label, profiles: mappedGroup))
            } else if let coord = await geocode(label) {
                Self.geocodeCache[label] = coord
                resolvedPins.append(LocationPin(id: label, coordinate: coord, label: label, profiles: mappedGroup))
            } else {
                missing.append(contentsOf: mappedGroup)
            }
            geocodeDone += 1
        }

        pins = resolvedPins.sorted { $0.profiles.count > $1.profiles.count }
        unresolved = missing.sorted { ($0.user_name ?? "") < ($1.user_name ?? "") }
        isGeocoding = false

        if !pins.isEmpty {
            withAnimation(.easeInOut(duration: 0.6)) {
                cameraPosition = .region(regionFitting(pins.map(\.coordinate)))
            }
        }
    }

    private func geocode(_ address: String) async -> CLLocationCoordinate2D? {
        await withCheckedContinuation { continuation in
            CLGeocoder().geocodeAddressString(address) { placemarks, _ in
                continuation.resume(returning: placemarks?.first?.location?.coordinate)
            }
        }
    }

    private func regionFitting(_ coords: [CLLocationCoordinate2D]) -> MKCoordinateRegion {
        let lats = coords.map(\.latitude)
        let lons = coords.map(\.longitude)
        let minLat = lats.min() ?? 0, maxLat = lats.max() ?? 0
        let minLon = lons.min() ?? 0, maxLon = lons.max() ?? 0
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max(2, (maxLat - minLat) * 1.6),
            longitudeDelta: max(2, (maxLon - minLon) * 1.6)
        )
        return MKCoordinateRegion(center: center, span: span)
    }
}

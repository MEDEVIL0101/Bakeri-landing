import SwiftUI
import SwiftData

// MARK: - SettingsView

struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var settings: UserSettings
    @Query private var densities: [IngredientDensity]

    @State private var showingExportSheet      = false
    @State private var showingImportSheet      = false
    @State private var exportedData: Data?     = nil
    @State private var importError: String?    = nil
    @State private var showingImportError      = false
    @State private var showingImportSuccess    = false
    @State private var showingAddDensity       = false
    @State private var newDensityName          = ""
    @State private var newDensityGrams         = ""
    @State private var showingClearDataAlert   = false

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }

    var body: some View {
        NavigationStack {
            Form {
                preferenceSection
                notificationsSection
                ingredientDensitiesSection
                dataSection
                aboutSection
                supabasePlaceholder
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.large)
            .sheet(isPresented: $showingExportSheet) {
                exportShareSheet
            }
            .sheet(isPresented: $showingImportSheet) {
                importPickerView
            }
            .sheet(isPresented: $showingAddDensity) {
                addDensitySheet
            }
            .alert("Import Failed", isPresented: $showingImportError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(importError ?? "Unknown error")
            }
            .alert("Import Successful", isPresented: $showingImportSuccess) {
                Button("OK", role: .cancel) { }
            } message: {
                Text("Your data has been imported successfully.")
            }
            .confirmationDialog("Clear All Data", isPresented: $showingClearDataAlert, titleVisibility: .visible) {
                Button("Clear All Data", role: .destructive) { clearAllData() }
            } message: {
                Text("This will permanently delete all recipes, orders, and tasks. This cannot be undone.")
            }
        }
    }

    // MARK: - Preferences

    private var preferenceSection: some View {
        Section {
            Picker("Unit System", selection: $settings.unitSystem) {
                ForEach(UnitSystem.allCases) { system in
                    Text(system.rawValue).tag(system)
                }
            }
            .tint(Color.bakerlyTerracotta)

            Toggle(isOn: $settings.showWeightInRecipes) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Show Weight in Recipes")
                    Text("Display gram/oz equivalents in ingredient lists")
                        .font(BakerlyFont.caption(12))
                        .foregroundStyle(Color.secondary)
                }
            }
            .tint(Color.bakerlyTerracotta)
        } header: {
            Label("Preferences", systemImage: "slider.horizontal.3")
        }
    }

    // MARK: - Notifications

    private var notificationsSection: some View {
        Section {
            Toggle(isOn: $settings.notificationsEnabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Order Reminders")
                    Text("Get notified 24h and 2h before order due dates")
                        .font(BakerlyFont.caption(12))
                        .foregroundStyle(Color.secondary)
                }
            }
            .tint(Color.bakerlyTerracotta)
            .onChange(of: settings.notificationsEnabled) { _, enabled in
                if enabled {
                    Task { _ = await NotificationService.shared.requestPermission() }
                } else {
                    NotificationService.shared.cancelAll()
                }
            }

            Button {
                Task {
                    let granted = await NotificationService.shared.requestPermission()
                    settings.notificationsEnabled = granted
                }
            } label: {
                Label("Request Permission", systemImage: "bell.badge")
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
        } header: {
            Label("Notifications", systemImage: "bell")
        }
    }

    // MARK: - Ingredient Densities

    private var ingredientDensitiesSection: some View {
        Section {
            let customDensities = densities.filter { $0.isCustom }
            if customDensities.isEmpty {
                Text("No custom ingredients yet")
                    .foregroundStyle(Color.secondary)
                    .font(BakerlyFont.body())
            } else {
                ForEach(customDensities) { density in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(density.name).font(BakerlyFont.body())
                            Text("\(String(format: "%.0f", density.gramsPerCup)) g/cup")
                                .font(BakerlyFont.caption(12))
                                .foregroundStyle(Color.secondary)
                        }
                        Spacer()
                    }
                }
                .onDelete { indices in
                    let toDelete = indices.map { customDensities[$0] }
                    toDelete.forEach { modelContext.delete($0) }
                    try? modelContext.save()
                }
            }

            Button {
                showingAddDensity = true
            } label: {
                Label("Add Custom Ingredient", systemImage: "plus.circle.fill")
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
        } header: {
            Label("Custom Ingredient Densities", systemImage: "scalemass")
        } footer: {
            Text("Add ingredients not in the built-in database for accurate weight conversions.")
        }
    }

    // MARK: - Data

    private var dataSection: some View {
        Section {
            Button {
                do {
                    let repo = SwiftDataRepository(modelContext: modelContext)
                    exportedData = try repo.exportAllData()
                    showingExportSheet = true
                } catch {
                    importError = error.localizedDescription
                    showingImportError = true
                }
            } label: {
                Label("Export All Data (JSON)", systemImage: "square.and.arrow.up")
                    .foregroundStyle(Color.bakerlyTerracotta)
            }

            Button {
                showingImportSheet = true
            } label: {
                Label("Import Data from JSON", systemImage: "square.and.arrow.down")
                    .foregroundStyle(Color.bakerlyTerracotta)
            }

            Button(role: .destructive) {
                showingClearDataAlert = true
            } label: {
                Label("Clear All Data", systemImage: "trash")
            }
        } header: {
            Label("Data Management", systemImage: "externaldrive")
        } footer: {
            Text("Export creates a JSON backup of all your recipes, orders, and tasks.")
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        Section {
            HStack {
                Label("Version", systemImage: "info.circle")
                Spacer()
                Text("\(appVersion) (\(buildNumber))")
                    .foregroundStyle(Color.secondary)
            }
            HStack {
                Label("App Icon", systemImage: "app")
                Spacer()
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.bakerlyBeige)
                    .frame(width: 40, height: 40)
                    .overlay {
                        Image(systemName: "birthday.cake.fill")
                            .foregroundStyle(Color.bakerlyTerracotta)
                    }
            }
            Link(destination: URL(string: "https://github.com/anthropics/claude-code/issues")!) {
                Label("Send Feedback", systemImage: "envelope")
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
        } header: {
            Label("About Bakerly", systemImage: "birthday.cake.fill")
        }
    }

    // MARK: - Supabase Placeholder

    private var supabasePlaceholder: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Label("Sync to Cloud (Coming Soon)", systemImage: "icloud.fill")
                    .font(BakerlyFont.subheading())
                    .foregroundStyle(Color.bakerlyBlue)

                Text("Bakerly is designed to migrate seamlessly to Supabase cloud sync. Your data architecture is already cloud-ready.")
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)

                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text("Repository pattern ready")
                        .font(BakerlyFont.caption(12))
                }
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text("All models are Codable")
                        .font(BakerlyFont.caption(12))
                }
                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text("Export/Import JSON works today")
                        .font(BakerlyFont.caption(12))
                }

                Button {
                    // Future: launch Supabase setup flow
                } label: {
                    Label("Learn About Migration", systemImage: "arrow.right.circle")
                        .frame(maxWidth: .infinity)
                }
                .bakerlySecondaryButton()
                .padding(.top, 4)
            }
            .padding(.vertical, 8)
        } header: {
            Label("Cloud Sync", systemImage: "cloud")
        }
    }

    // MARK: - Export Sheet

    private var exportShareSheet: some View {
        Group {
            if let data = exportedData {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("BakerlyBackup.json")
                let _ = try? data.write(to: url)
                ShareLink(item: url, message: Text("Bakerly Data Export")) {
                    Label("Share Backup File", systemImage: "square.and.arrow.up")
                }
            }
        }
    }

    // MARK: - Import View

    private var importPickerView: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "square.and.arrow.down.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(Color.bakerlyTerracotta)
                Text("Import Bakerly Data")
                    .font(BakerlyFont.display())
                Text("Import a previously exported JSON backup. This will add to your existing data (it will not overwrite).")
                    .font(BakerlyFont.body())
                    .foregroundStyle(Color.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                Text("Select a BakerlyBackup.json file from Files or paste its contents.")
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                // In a real app, use a DocumentPicker here
                Button("Cancel") {
                    showingImportSheet = false
                }
                .bakerlySecondaryButton()
            }
            .padding()
            .navigationTitle("Import Data")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { showingImportSheet = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Add Density Sheet

    private var addDensitySheet: some View {
        NavigationStack {
            Form {
                Section("Ingredient Details") {
                    TextField("Name (e.g. Almond Milk)", text: $newDensityName)
                    HStack {
                        TextField("Grams per cup", text: $newDensityGrams)
                            .keyboardType(.decimalPad)
                        Text("g/cup")
                            .foregroundStyle(Color.secondary)
                    }
                }
                Section {
                    Text("Example: All-purpose flour = 120 g/cup, Granulated sugar = 200 g/cup")
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                }
            }
            .navigationTitle("Custom Ingredient")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        newDensityName  = ""
                        newDensityGrams = ""
                        showingAddDensity = false
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add") {
                        addCustomDensity()
                    }
                    .disabled(newDensityName.isEmpty || (Double(newDensityGrams) == nil))
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Actions

    private func addCustomDensity() {
        guard !newDensityName.isEmpty, let grams = Double(newDensityGrams) else { return }
        let density = IngredientDensity(name: newDensityName, gramsPerCup: grams, isCustom: true)
        modelContext.insert(density)
        try? modelContext.save()
        newDensityName  = ""
        newDensityGrams = ""
        showingAddDensity = false
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    private func clearAllData() {
        do {
            try modelContext.delete(model: Recipe.self)
            try modelContext.delete(model: Order.self)
            try modelContext.delete(model: BakingTask.self)
            try modelContext.save()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            importError = error.localizedDescription
            showingImportError = true
        }
    }
}

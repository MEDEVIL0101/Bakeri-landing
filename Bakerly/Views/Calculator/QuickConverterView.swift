import SwiftUI
import SwiftData

// MARK: - QuickConverterView

struct QuickConverterView: View {
    @Query(sort: \IngredientDensity.name) private var densities: [IngredientDensity]
    @EnvironmentObject private var settings: UserSettings

    @State private var selectedDensity: IngredientDensity? = nil
    @State private var inputAmount    = ""
    @State private var inputMode: InputMode = .volume
    @State private var inputVolumeUnit: VolumeUnit = .cup
    @State private var inputWeightUnit: WeightUnit = .gram
    @State private var searchText     = ""

    enum InputMode: String, CaseIterable {
        case volume = "Volume → Weight"
        case weight = "Weight → Volume"
    }

    // MARK: - Computed

    private var filteredDensities: [IngredientDensity] {
        guard !searchText.isEmpty else { return densities }
        return densities.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    private var convertedValue: Double? {
        guard let density = selectedDensity,
              let amount = Double(inputAmount), amount > 0 else { return nil }

        switch inputMode {
        case .volume:
            return UnitConverter.toGrams(amount: amount, unit: inputVolumeUnit,
                                         gramsPerCup: density.gramsPerCup)
        case .weight:
            let grams = amount * inputWeightUnit.toGrams
            return UnitConverter.fromGrams(grams, toUnit: inputVolumeUnit,
                                           gramsPerCup: density.gramsPerCup)
        }
    }

    private var outputLabel: String {
        guard let value = convertedValue else { return "—" }
        switch inputMode {
        case .volume:
            let unit = settings.unitSystem.preferredWeightUnit
            let converted = value / unit.toGrams
            return "\(converted.shortString) \(unit.abbreviation)"
        case .weight:
            return "\(value.shortString) \(inputVolumeUnit.abbreviation)"
        }
    }

    private var outputSubtitle: String? {
        guard let density = selectedDensity,
              let amount = Double(inputAmount), amount > 0 else { return nil }
        switch inputMode {
        case .volume:
            // Show both US and metric weight
            let grams = UnitConverter.toGrams(amount: amount, unit: inputVolumeUnit,
                                              gramsPerCup: density.gramsPerCup)
            let oz = grams / WeightUnit.ounce.toGrams
            return "\(grams.shortString) g  ·  \(oz.shortString) oz"
        case .weight:
            return nil
        }
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Ingredient selector
                ingredientSelector

                // Input/Output card
                conversionCard

                // Common conversions table
                if let density = selectedDensity {
                    quickReferenceTable(for: density)
                }
            }
            .padding(16)
        }
    }

    // MARK: - Ingredient Selector

    private var ingredientSelector: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Select Ingredient")
                .font(BakerlyFont.subheading())

            // Search
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color.secondary)
                TextField("Search ingredients…", text: $searchText)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color.secondary)
                    }
                }
            }
            .padding(10)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            // Results list (scrollable selection)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(filteredDensities) { density in
                        Button {
                            withAnimation(.spring(response: 0.3)) {
                                selectedDensity = density
                            }
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        } label: {
                            Text(density.name)
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(selectedDensity?.id == density.id
                                    ? .white : Color.bakerlyTerracotta)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(selectedDensity?.id == density.id
                                    ? Color.bakerlyTerracotta
                                    : Color.bakerlyTerracotta.opacity(0.1))
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            if let selected = selectedDensity {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.bakerlyTerracotta)
                    Text("\(selected.name): \(String(format: "%.0f", selected.gramsPerCup)) g/cup")
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                }
            }
        }
        .padding(16)
        .bakerlyCard()
    }

    // MARK: - Conversion Card

    private var conversionCard: some View {
        VStack(spacing: 16) {
            // Mode toggle
            Picker("Mode", selection: $inputMode) {
                ForEach(InputMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            Divider()

            // Input
            VStack(alignment: .leading, spacing: 8) {
                Text("Input")
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                    .textCase(.uppercase)

                HStack(spacing: 12) {
                    TextField("Amount", text: $inputAmount)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.leading)

                    if inputMode == .volume {
                        Picker("Volume Unit", selection: $inputVolumeUnit) {
                            ForEach(VolumeUnit.allCases) { unit in
                                Text(unit.abbreviation).tag(unit)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(Color.bakerlyTerracotta)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.bakerlyTerracotta.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    } else {
                        Picker("Weight Unit", selection: $inputWeightUnit) {
                            ForEach(WeightUnit.allCases) { unit in
                                Text(unit.abbreviation).tag(unit)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(Color.bakerlyTerracotta)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color.bakerlyTerracotta.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }

            // Arrow
            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.bakerlyTerracotta)

            // Output
            VStack(alignment: .leading, spacing: 4) {
                Text("Result")
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                    .textCase(.uppercase)

                Text(outputLabel)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.bakerlyTerracotta)
                    .contentTransition(.numericText())
                    .animation(.spring(response: 0.3), value: outputLabel)

                if let sub = outputSubtitle {
                    Text(sub)
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                }
            }

            if selectedDensity == nil {
                Label("Select an ingredient above to convert", systemImage: "hand.tap")
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                    .padding(.top, 4)
            }
        }
        .padding(20)
        .bakerlyCard()
    }

    // MARK: - Quick Reference Table

    private func quickReferenceTable(for density: IngredientDensity) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            BakerlySectionHeader(title: "Quick Reference: \(density.name)")

            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                GridRow {
                    Text("Volume").font(BakerlyFont.caption()).foregroundStyle(Color.secondary)
                    Text("Grams").font(BakerlyFont.caption()).foregroundStyle(Color.secondary)
                    Text("Ounces").font(BakerlyFont.caption()).foregroundStyle(Color.secondary)
                }
                Divider().gridCellUnsizedAxes(.horizontal)

                let rows: [(String, Double)] = [
                    ("1 tsp",  density.gramsPerCup / 48),
                    ("1 tbsp", density.gramsPerCup / 16),
                    ("¼ cup",  density.gramsPerCup * 0.25),
                    ("⅓ cup",  density.gramsPerCup * 0.333),
                    ("½ cup",  density.gramsPerCup * 0.5),
                    ("1 cup",  density.gramsPerCup),
                    ("2 cups", density.gramsPerCup * 2)
                ]

                ForEach(rows, id: \.0) { row in
                    GridRow {
                        Text(row.0)
                            .font(BakerlyFont.body())
                        Text("\(row.1.shortString) g")
                            .font(BakerlyFont.mono())
                            .foregroundStyle(Color.bakerlyTerracotta)
                        Text("\((row.1 / WeightUnit.ounce.toGrams).shortString) oz")
                            .font(BakerlyFont.mono())
                            .foregroundStyle(Color.bakerlyGold)
                    }
                }
            }
            .padding(16)
        }
        .padding(.vertical, 16)
        .bakerlyCard()
    }
}

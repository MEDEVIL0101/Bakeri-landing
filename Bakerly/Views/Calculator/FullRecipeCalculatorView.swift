import SwiftUI
import SwiftData

// MARK: - FullRecipeCalculatorView

struct FullRecipeCalculatorView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Recipe.name) private var recipes: [Recipe]
    @Query(sort: \IngredientDensity.name) private var densities: [IngredientDensity]
    @EnvironmentObject private var settings: UserSettings

    var preloadedRecipe: Recipe? = nil

    @State private var selectedRecipe: Recipe? = nil
    @State private var scalingMode: ScalingMode = .yield
    @State private var desiredYield = ""
    @State private var scaleFactor  = "1.0"
    @State private var manualIngredients: [ManualIngredient] = []
    @State private var showingRecipePicker = false
    @State private var showingSaveSheet    = false
    @State private var showingAddToOrder   = false
    @State private var savedRecipeName     = ""

    enum ScalingMode: String, CaseIterable {
        case yield  = "Scale by Yield"
        case factor = "Scale by Factor"
    }

    // MARK: - Ingredient Data

    struct ManualIngredient: Identifiable {
        let id = UUID()
        var name       = ""
        var amount     = "1"
        var unit       = VolumeUnit.cup
        var gramsPerCup = 120.0
    }

    // MARK: - Computed

    private var activeIngredients: [(name: String, volumeAmount: Double, unit: VolumeUnit, gramsPerCup: Double)] {
        if let recipe = selectedRecipe {
            return recipe.sortedIngredients.map { ing in
                (ing.name, ing.volumeAmount, ing.volumeUnit, ing.gramsPerCup)
            }
        }
        return manualIngredients.compactMap { m in
            guard !m.name.isEmpty, let amount = Double(m.amount) else { return nil }
            return (m.name, amount, m.unit, m.gramsPerCup)
        }
    }

    private var computedScaleFactor: Double {
        switch scalingMode {
        case .factor:
            return Double(scaleFactor) ?? 1.0
        case .yield:
            guard let recipe = selectedRecipe,
                  recipe.yieldQuantity > 0,
                  let desired = Double(desiredYield), desired > 0 else {
                return Double(scaleFactor) ?? 1.0
            }
            return desired / recipe.yieldQuantity
        }
    }

    private var scaledRows: [(name: String, origVol: String, origWeight: String, scaledVol: String, scaledWeight: String)] {
        activeIngredients.map { ing in
            let origGrams   = UnitConverter.toGrams(amount: ing.volumeAmount, unit: ing.unit, gramsPerCup: ing.gramsPerCup)
            let scaledAmt   = ing.volumeAmount * computedScaleFactor
            let scaledGrams = origGrams * computedScaleFactor
            let wUnit = settings.unitSystem.preferredWeightUnit

            return (
                name:        ing.name,
                origVol:     "\(ing.volumeAmount.shortString) \(ing.unit.abbreviation)",
                origWeight:  "\((origGrams / wUnit.toGrams).shortString) \(wUnit.abbreviation)",
                scaledVol:   "\(scaledAmt.shortString) \(ing.unit.abbreviation)",
                scaledWeight: "\((scaledGrams / wUnit.toGrams).shortString) \(wUnit.abbreviation)"
            )
        }
    }

    private var totalFlourWeight: Double {
        activeIngredients
            .filter { $0.name.localizedCaseInsensitiveContains("flour") }
            .reduce(0) {
                $0 + UnitConverter.toGrams(amount: $1.volumeAmount * computedScaleFactor,
                                           unit: $1.unit,
                                           gramsPerCup: $1.gramsPerCup)
            }
    }

    private var totalBatchWeight: Double {
        activeIngredients.reduce(0) {
            $0 + UnitConverter.toGrams(amount: $1.volumeAmount * computedScaleFactor,
                                       unit: $1.unit,
                                       gramsPerCup: $1.gramsPerCup)
        }
    }

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Source selector
                sourceSection

                if !activeIngredients.isEmpty {
                    // Scaling controls
                    scalingSection

                    // Ingredients table
                    ingredientsTable

                    // Totals
                    totalsSection

                    // Actions
                    actionButtons
                } else {
                    // Empty prompt
                    VStack(spacing: 12) {
                        Image(systemName: "plus.rectangle.on.rectangle")
                            .font(.system(size: 48))
                            .foregroundStyle(Color.bakerlyTerracotta.opacity(0.4))
                        Text("Load a recipe or add ingredients manually")
                            .font(BakerlyFont.body())
                            .foregroundStyle(Color.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(40)
                }
            }
            .padding(16)
        }
        .onAppear {
            if let r = preloadedRecipe { selectedRecipe = r }
        }
        .sheet(isPresented: $showingRecipePicker) {
            recipePickerSheet
        }
        .sheet(isPresented: $showingSaveSheet) {
            saveScaledRecipeSheet
        }
    }

    // MARK: - Source Section

    private var sourceSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recipe Source")
                .font(BakerlyFont.subheading())

            HStack(spacing: 12) {
                Button {
                    showingRecipePicker = true
                } label: {
                    HStack {
                        Image(systemName: "book.fill")
                        Text(selectedRecipe?.name ?? "Load from Recipes")
                    }
                    .frame(maxWidth: .infinity)
                }
                .bakerlySecondaryButton()

                Button {
                    selectedRecipe = nil
                } label: {
                    Label("Manual", systemImage: "pencil")
                        .frame(maxWidth: .infinity)
                }
                .if(selectedRecipe == nil) { $0.bakerlyPrimaryButton(fullWidth: false) }
                .if(selectedRecipe != nil) { $0.bakerlySecondaryButton() }
            }

            if selectedRecipe == nil {
                // Manual ingredient input
                VStack(spacing: 0) {
                    ForEach($manualIngredients) { $ing in
                        HStack(spacing: 8) {
                            TextField("Name", text: $ing.name)
                                .font(BakerlyFont.body())
                            TextField("Amt", text: $ing.amount)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 52)
                            Picker("", selection: $ing.unit) {
                                ForEach(VolumeUnit.allCases) { u in
                                    Text(u.abbreviation).tag(u)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(Color.bakerlyTerracotta)
                            .frame(width: 68)
                            Button { manualIngredients.removeAll { $0.id == ing.id } } label: {
                                Image(systemName: "minus.circle.fill")
                                    .foregroundStyle(Color.bakerlyRed)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.vertical, 8)
                        .padding(.horizontal, 12)
                        if ing.id != manualIngredients.last?.id {
                            Divider()
                        }
                    }

                    Button {
                        manualIngredients.append(ManualIngredient())
                    } label: {
                        Label("Add Ingredient", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    .foregroundStyle(Color.bakerlyTerracotta)
                }
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
        .bakerlyCard()
    }

    // MARK: - Scaling Section

    private var scalingSection: some View {
        VStack(spacing: 12) {
            Picker("Scaling Mode", selection: $scalingMode) {
                ForEach(ScalingMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            HStack(spacing: 16) {
                if scalingMode == .yield, let recipe = selectedRecipe {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Original: \(recipe.yieldDescription)")
                            .font(BakerlyFont.caption())
                            .foregroundStyle(Color.secondary)
                        HStack {
                            TextField("Desired yield", text: $desiredYield)
                                .keyboardType(.decimalPad)
                                .font(BakerlyFont.subheading())
                                .padding(10)
                                .background(Color(.secondarySystemBackground))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                            Text(recipe.yieldUnitRaw)
                                .font(BakerlyFont.body())
                                .foregroundStyle(Color.secondary)
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Scale Factor")
                            .font(BakerlyFont.caption())
                            .foregroundStyle(Color.secondary)
                        HStack(spacing: 12) {
                            ForEach(["0.5", "1", "1.5", "2", "3"], id: \.self) { preset in
                                Button(preset + "×") {
                                    scaleFactor = preset
                                }
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                                .foregroundStyle(scaleFactor == preset ? .white : Color.bakerlyTerracotta)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(scaleFactor == preset
                                    ? Color.bakerlyTerracotta
                                    : Color.bakerlyTerracotta.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            TextField("Custom", text: $scaleFactor)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.center)
                                .frame(width: 60)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color(.secondarySystemBackground))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                }

                Spacer()

                // Live factor badge
                VStack(spacing: 2) {
                    Text(String(format: "%.2f×", computedScaleFactor))
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.bakerlyTerracotta)
                        .contentTransition(.numericText())
                    Text("factor")
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                }
            }
        }
        .padding(16)
        .bakerlyCard()
    }

    // MARK: - Ingredients Table

    private var ingredientsTable: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text("Ingredient").font(BakerlyFont.caption()).foregroundStyle(Color.secondary).frame(maxWidth: .infinity, alignment: .leading)
                Text("Original").font(BakerlyFont.caption()).foregroundStyle(Color.secondary).frame(width: 88, alignment: .trailing)
                Text("Scaled").font(BakerlyFont.caption()).foregroundStyle(Color.bakerlyTerracotta).frame(width: 88, alignment: .trailing)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.bakerlyTerracotta.opacity(0.06))

            ForEach(Array(scaledRows.enumerated()), id: \.offset) { _, row in
                VStack(spacing: 0) {
                    HStack(alignment: .center) {
                        Text(row.name)
                            .font(BakerlyFont.body())
                            .frame(maxWidth: .infinity, alignment: .leading)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(row.origVol)
                                .font(BakerlyFont.mono(12))
                            Text(row.origWeight)
                                .font(BakerlyFont.caption(11))
                                .foregroundStyle(Color.secondary)
                        }
                        .frame(width: 88, alignment: .trailing)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(row.scaledVol)
                                .font(BakerlyFont.mono(13))
                                .foregroundStyle(Color.bakerlyTerracotta)
                                .fontWeight(.semibold)
                            Text(row.scaledWeight)
                                .font(BakerlyFont.caption(11))
                                .foregroundStyle(Color.bakerlyWarmBrown)
                        }
                        .frame(width: 88, alignment: .trailing)
                        .contentTransition(.numericText())
                        .animation(.spring(response: 0.3), value: computedScaleFactor)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    if row.name != scaledRows.last?.name {
                        Divider().padding(.leading, 16)
                    }
                }
            }
        }
        .bakerlyCard(cornerRadius: 14)
    }

    // MARK: - Totals

    private var totalsSection: some View {
        HStack(spacing: 0) {
            totalCell(
                label: "Flour Weight",
                value: "\((totalFlourWeight / settings.unitSystem.preferredWeightUnit.toGrams).shortString) \(settings.unitSystem.preferredWeightUnit.abbreviation)",
                icon: "leaf.fill",
                color: .bakerlyGold
            )
            Divider().frame(height: 50)
            totalCell(
                label: "Total Batch",
                value: "\((totalBatchWeight / settings.unitSystem.preferredWeightUnit.toGrams).shortString) \(settings.unitSystem.preferredWeightUnit.abbreviation)",
                icon: "scalemass.fill",
                color: .bakerlyTerracotta
            )
            Divider().frame(height: 50)
            totalCell(
                label: "Items",
                value: "\(activeIngredients.count)",
                icon: "list.number",
                color: .bakerlyBlue
            )
        }
        .padding(.vertical, 12)
        .bakerlyCard()
    }

    private func totalCell(label: String, value: String, icon: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).foregroundStyle(color).font(.system(size: 16))
            Text(value).font(BakerlyFont.subheading(15))
            Text(label).font(BakerlyFont.caption(11)).foregroundStyle(Color.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 12) {
            if selectedRecipe != nil {
                Button {
                    showingSaveSheet = true
                } label: {
                    Label("Save Scaled Version as New Recipe", systemImage: "plus.square.on.square")
                }
                .bakerlyPrimaryButton(fullWidth: true)
            }

            Button {
                showingAddToOrder = true
            } label: {
                Label("Add to New Order", systemImage: "shippingbox.fill")
                    .frame(maxWidth: .infinity)
            }
            .bakerlySecondaryButton()
        }
    }

    // MARK: - Recipe Picker Sheet

    private var recipePickerSheet: some View {
        NavigationStack {
            List(recipes) { recipe in
                Button {
                    selectedRecipe = recipe
                    if let qty = recipe.yieldQuantity as Double? {
                        desiredYield = qty.cleanString
                    }
                    showingRecipePicker = false
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(recipe.name).font(BakerlyFont.subheading())
                            Text(recipe.yieldDescription).font(BakerlyFont.caption()).foregroundStyle(Color.secondary)
                        }
                        Spacer()
                        if selectedRecipe?.id == recipe.id {
                            Image(systemName: "checkmark").foregroundStyle(Color.bakerlyTerracotta)
                        }
                    }
                }
                .foregroundStyle(Color.primary)
            }
            .navigationTitle("Select Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { showingRecipePicker = false }
                }
            }
        }
    }

    // MARK: - Save Sheet

    private var saveScaledRecipeSheet: some View {
        NavigationStack {
            Form {
                Section("New Recipe Name") {
                    TextField("Name", text: $savedRecipeName)
                }
                Section {
                    Text("This will save the current scaled amounts as a new recipe.")
                        .font(BakerlyFont.body())
                        .foregroundStyle(Color.secondary)
                }
            }
            .navigationTitle("Save Scaled Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let r = selectedRecipe {
                    let f = computedScaleFactor
                    savedRecipeName = "\(r.name) (×\(f.shortString))"
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { showingSaveSheet = false }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        saveScaledRecipe()
                        showingSaveSheet = false
                    }
                    .disabled(savedRecipeName.isEmpty)
                }
            }
        }
    }

    private func saveScaledRecipe() {
        guard let original = selectedRecipe else { return }
        let newRecipe = Recipe(
            name: savedRecipeName,
            yieldQuantity: original.yieldQuantity * computedScaleFactor,
            yieldUnit: original.yieldUnit,
            prepTimeMinutes: original.prepTimeMinutes,
            bakeTimeMinutes: original.bakeTimeMinutes,
            instructions: original.instructions,
            notes: "Scaled from \"\(original.name)\" at \(String(format: "%.2f", computedScaleFactor))×",
            tags: original.tags
        )
        for (idx, ing) in original.sortedIngredients.enumerated() {
            newRecipe.ingredients.append(RecipeIngredient(
                name: ing.name,
                volumeAmount: ing.volumeAmount * computedScaleFactor,
                volumeUnit: ing.volumeUnit,
                gramsPerCup: ing.gramsPerCup,
                notes: ing.notes,
                sortOrder: idx
            ))
        }
        modelContext.insert(newRecipe)
        try? modelContext.save()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

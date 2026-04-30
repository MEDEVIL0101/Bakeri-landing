import SwiftUI
import SwiftData
import PhotosUI

// MARK: - AddEditRecipeView

struct AddEditRecipeView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss)      private var dismiss
    @EnvironmentObject private var settings: UserSettings

    // When non-nil, we're editing an existing recipe
    var recipe: Recipe? = nil

    // MARK: - Form State
    @State private var name             = ""
    @State private var yieldQuantity    = "12"
    @State private var yieldUnit        = YieldUnit.cookies
    @State private var prepTime         = ""
    @State private var bakeTime         = ""
    @State private var instructions     = ""
    @State private var notes            = ""
    @State private var tags: [String]   = []
    @State private var newTag           = ""
    @State private var isFavorite       = false
    @State private var ingredients: [DraftIngredient] = []

    // Image
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var imageData: Data?

    // UI state
    @State private var showingAddIngredient = false
    @State private var showingDiscardAlert  = false
    @State private var isSaving             = false
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case name, prepTime, bakeTime, instructions, notes, newTag, yield
    }

    // MARK: - Draft Ingredient

    struct DraftIngredient: Identifiable {
        let id = UUID()
        var name       = ""
        var amount     = "1"
        var unit       = VolumeUnit.cup
        var gramsPerCup = 120.0
        var notes      = ""
    }

    private var isEditing: Bool { recipe != nil }

    private var hasChanges: Bool {
        guard let recipe = recipe else { return !name.isEmpty }
        return name              != recipe.name
            || instructions      != recipe.instructions
            || notes             != recipe.notes
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                basicInfoSection
                imageSection
                ingredientsSection
                instructionsSection
                notesSection
                tagsSection
            }
            .navigationTitle(isEditing ? "Edit Recipe" : "New Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .onAppear { populateIfEditing() }
            .confirmationDialog("Discard Changes?", isPresented: $showingDiscardAlert) {
                Button("Discard", role: .destructive) { dismiss() }
            }
            .onChange(of: selectedPhotoItem) { _, item in
                Task {
                    if let data = try? await item?.loadTransferable(type: Data.self) {
                        imageData = data
                    }
                }
            }
        }
    }

    // MARK: - Sections

    private var basicInfoSection: some View {
        Section("About") {
            HStack {
                Image(systemName: "fork.knife")
                    .foregroundStyle(Color.bakerlyTerracotta)
                TextField("Recipe Name", text: $name)
                    .font(BakerlyFont.subheading())
                    .focused($focusedField, equals: .name)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .yield }
                Button {
                    isFavorite.toggle()
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    Image(systemName: isFavorite ? "star.fill" : "star")
                        .foregroundStyle(isFavorite ? .yellow : Color.bakerlyGray3)
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 12) {
                TextField("Yield", text: $yieldQuantity)
                    .keyboardType(.decimalPad)
                    .focused($focusedField, equals: .yield)
                    .frame(width: 70)
                Picker("Unit", selection: $yieldUnit) {
                    ForEach(YieldUnit.allCases) { unit in
                        Text(unit.displayName).tag(unit)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.bakerlyTerracotta)
            }

            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Prep time (min)", systemImage: "clock")
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                    TextField("0", text: $prepTime)
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .prepTime)
                        .textFieldStyle(.roundedBorder)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Label("Bake time (min)", systemImage: "oven.fill")
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                    TextField("0", text: $bakeTime)
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .bakeTime)
                        .textFieldStyle(.roundedBorder)
                }
            }
        }
    }

    private var imageSection: some View {
        Section("Photo") {
            PhotosPicker(
                selection: $selectedPhotoItem,
                matching: .images,
                photoLibrary: .shared()
            ) {
                if let data = imageData, let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity)
                        .frame(height: 180)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                } else {
                    HStack {
                        Image(systemName: "photo.on.rectangle.angled")
                            .foregroundStyle(Color.bakerlyTerracotta)
                        Text("Add Photo")
                            .foregroundStyle(Color.bakerlyTerracotta)
                    }
                }
            }

            if imageData != nil {
                Button("Remove Photo", role: .destructive) {
                    imageData = nil
                    selectedPhotoItem = nil
                }
            }
        }
    }

    private var ingredientsSection: some View {
        Section {
            ForEach($ingredients) { $ing in
                IngredientFormRow(ingredient: $ing, unitSystem: settings.unitSystem)
            }
            .onDelete { ingredients.remove(atOffsets: $0) }
            .onMove { ingredients.move(fromOffsets: $0, toOffset: $1) }

            Button {
                withAnimation {
                    ingredients.append(DraftIngredient())
                }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                Label("Add Ingredient", systemImage: "plus.circle.fill")
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
        } header: {
            HStack {
                Text("Ingredients")
                Spacer()
                EditButton()
                    .font(.system(size: 13))
                    .tint(Color.bakerlyTerracotta)
            }
        }
    }

    private var instructionsSection: some View {
        Section("Instructions") {
            TextEditor(text: $instructions)
                .frame(minHeight: 140)
                .font(BakerlyFont.body())
                .focused($focusedField, equals: .instructions)
                .overlay(alignment: .topLeading) {
                    if instructions.isEmpty {
                        Text("Write your steps here…\nTip: each line becomes a numbered step")
                            .font(BakerlyFont.body())
                            .foregroundStyle(Color.secondary.opacity(0.6))
                            .padding(.top, 8)
                            .padding(.leading, 4)
                            .allowsHitTesting(false)
                    }
                }
        }
    }

    private var notesSection: some View {
        Section("Notes") {
            TextEditor(text: $notes)
                .frame(minHeight: 80)
                .font(BakerlyFont.body())
                .focused($focusedField, equals: .notes)
                .overlay(alignment: .topLeading) {
                    if notes.isEmpty {
                        Text("Tips, variations, storage info…")
                            .font(BakerlyFont.body())
                            .foregroundStyle(Color.secondary.opacity(0.6))
                            .padding(.top, 8)
                            .padding(.leading, 4)
                            .allowsHitTesting(false)
                    }
                }
        }
    }

    private var tagsSection: some View {
        Section("Tags") {
            // Existing tags
            if !tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tags, id: \.self) { tag in
                            HStack(spacing: 4) {
                                Text(tag)
                                    .font(.system(size: 13, weight: .medium))
                                Button {
                                    tags.removeAll { $0 == tag }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 12))
                                }
                            }
                            .foregroundStyle(Color.bakerlyTerracotta)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.bakerlyTerracotta.opacity(0.12))
                            .clipShape(Capsule())
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            // Add new tag
            HStack {
                Image(systemName: "tag")
                    .foregroundStyle(Color.bakerlyGold)
                TextField("Add tag…", text: $newTag)
                    .font(BakerlyFont.body())
                    .focused($focusedField, equals: .newTag)
                    .submitLabel(.done)
                    .onSubmit { addTag() }
                if !newTag.isEmpty {
                    Button(action: addTag) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(Color.bakerlyTerracotta)
                    }
                    .buttonStyle(.plain)
                }
            }

            // Suggested tags
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestedTags, id: \.self) { tag in
                        if !tags.contains(tag) {
                            Button(tag) {
                                tags.append(tag)
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            }
                            .font(.system(size: 12))
                            .foregroundStyle(Color.bakerlyGray4)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.bakerlyGray1)
                            .clipShape(Capsule())
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Cancel") {
                if hasChanges {
                    showingDiscardAlert = true
                } else {
                    dismiss()
                }
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("Save") {
                saveRecipe()
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(name.trimmingCharacters(in: .whitespaces).isEmpty
                             ? Color.secondary
                             : Color.bakerlyTerracotta)
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
        }
        ToolbarItem(placement: .keyboard) {
            Button("Done") { focusedField = nil }
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: - Logic

    private var suggestedTags: [String] {
        ["Cookies", "Bread", "Cake", "Muffins", "Pastry", "Gluten-Free",
         "Vegan", "Quick", "Holiday", "Birthday", "Chocolate", "Sourdough"]
    }

    private func addTag() {
        let tag = newTag.trimmingCharacters(in: .whitespaces)
        guard !tag.isEmpty, !tags.contains(tag) else { return }
        tags.append(tag)
        newTag = ""
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func populateIfEditing() {
        guard let recipe = recipe else { return }
        name          = recipe.name
        yieldQuantity = recipe.yieldQuantity.cleanString
        yieldUnit     = recipe.yieldUnit
        prepTime      = recipe.prepTimeMinutes > 0 ? "\(recipe.prepTimeMinutes)" : ""
        bakeTime      = recipe.bakeTimeMinutes > 0 ? "\(recipe.bakeTimeMinutes)" : ""
        instructions  = recipe.instructions
        notes         = recipe.notes
        tags          = recipe.tags
        isFavorite    = recipe.isFavorite
        imageData     = recipe.imageData
        ingredients   = recipe.sortedIngredients.map { ing in
            var d = DraftIngredient()
            d.name        = ing.name
            d.amount      = ing.volumeAmount.cleanString
            d.unit        = ing.volumeUnit
            d.gramsPerCup = ing.gramsPerCup
            d.notes       = ing.notes
            return d
        }
    }

    private func saveRecipe() {
        isSaving = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()

        let target = recipe ?? Recipe(name: "")
        target.name             = name.trimmingCharacters(in: .whitespaces)
        target.yieldQuantity    = Double(yieldQuantity) ?? 1
        target.yieldUnit        = yieldUnit
        target.prepTimeMinutes  = Int(prepTime) ?? 0
        target.bakeTimeMinutes  = Int(bakeTime) ?? 0
        target.instructions     = instructions
        target.notes            = notes
        target.tags             = tags
        target.isFavorite       = isFavorite
        target.imageData        = imageData

        // Rebuild ingredients
        target.ingredients.forEach { modelContext.delete($0) }
        target.ingredients = []
        for (idx, draft) in ingredients.enumerated() {
            guard !draft.name.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            let ing = RecipeIngredient(
                name: draft.name.trimmingCharacters(in: .whitespaces),
                volumeAmount: Double(draft.amount) ?? 1,
                volumeUnit: draft.unit,
                gramsPerCup: draft.gramsPerCup,
                notes: draft.notes,
                sortOrder: idx
            )
            target.ingredients.append(ing)
        }

        if recipe == nil {
            modelContext.insert(target)
        }
        try? modelContext.save()
        dismiss()
    }
}

// MARK: - IngredientFormRow

struct IngredientFormRow: View {
    @Binding var ingredient: AddEditRecipeView.DraftIngredient
    var unitSystem: UnitSystem = .us
    @Query private var densities: [IngredientDensity]

    @State private var showingDensityPicker = false

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                TextField("Ingredient name", text: $ingredient.name)
                    .font(BakerlyFont.body())
                Spacer()
                TextField("Amt", text: $ingredient.amount)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 52)
                Picker("", selection: $ingredient.unit) {
                    ForEach(VolumeUnit.allCases) { unit in
                        Text(unit.abbreviation).tag(unit)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.bakerlyTerracotta)
                .frame(width: 70)
            }

            // Density / weight hint
            HStack {
                Button {
                    autoFillDensity()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "scalemass")
                            .font(.system(size: 11))
                        Text("\(String(format: "%.0f", ingredient.gramsPerCup)) g/cup")
                            .font(BakerlyFont.caption(12))
                    }
                    .foregroundStyle(Color.bakerlyGold)
                }
                .buttonStyle(.plain)
                Spacer()
                if let weight = weightHint {
                    Text(weight)
                        .font(BakerlyFont.caption(12))
                        .foregroundStyle(Color.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var weightHint: String? {
        guard ingredient.gramsPerCup > 0,
              let amount = Double(ingredient.amount) else { return nil }
        let grams = UnitConverter.toGrams(amount: amount, unit: ingredient.unit,
                                          gramsPerCup: ingredient.gramsPerCup)
        let unit = unitSystem.preferredWeightUnit
        let converted = grams / unit.toGrams
        return "≈ \(converted.shortString) \(unit.abbreviation)"
    }

    private func autoFillDensity() {
        let name = ingredient.name.lowercased()
        if let match = densities.first(where: { $0.name.lowercased().contains(name) || name.contains($0.name.lowercased()) }) {
            ingredient.gramsPerCup = match.gramsPerCup
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}

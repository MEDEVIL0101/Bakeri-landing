import SwiftUI
import SwiftData

// MARK: - RecipeDetailView

struct RecipeDetailView: View {
    @Environment(\.modelContext)  private var modelContext
    @Environment(\.dismiss)       private var dismiss
    @Bindable var recipe: Recipe

    @State private var showingEdit           = false
    @State private var showingDeleteAlert    = false
    @State private var showingCalculator     = false
    @State private var showingAddToSchedule  = false
    @State private var showingAddToOrder     = false
    @EnvironmentObject private var settings: UserSettings

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Hero Image
                heroSection

                // Content
                VStack(alignment: .leading, spacing: 24) {
                    // Stats row
                    statsRow

                    // Tags
                    if !recipe.tags.isEmpty {
                        tagsSection
                    }

                    // Ingredients
                    ingredientsSection

                    // Instructions
                    if !recipe.instructions.isEmpty {
                        instructionsSection
                    }

                    // Notes
                    if !recipe.notes.isEmpty {
                        notesSection
                    }

                    // Action buttons
                    actionButtons
                }
                .padding(20)
            }
        }
        .navigationTitle(recipe.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbar { toolbar }
        .sheet(isPresented: $showingEdit) {
            AddEditRecipeView(recipe: recipe)
        }
        .sheet(isPresented: $showingAddToSchedule) {
            AddBakingTaskView(preselectedRecipe: recipe)
        }
        .confirmationDialog("Delete Recipe", isPresented: $showingDeleteAlert, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                modelContext.delete(recipe)
                try? modelContext.save()
                dismiss()
            }
        } message: {
            Text("This cannot be undone.")
        }
    }

    // MARK: - Hero

    private var heroSection: some View {
        ZStack(alignment: .bottomLeading) {
            Group {
                if let data = recipe.imageData, let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        Color.bakerlyBeige
                        Image(systemName: "birthday.cake")
                            .font(.system(size: 72))
                            .foregroundStyle(Color.bakerlyTerracotta.opacity(0.3))
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 260)
            .clipped()

            // Favorite badge
            if recipe.isFavorite {
                HStack {
                    Spacer()
                    Image(systemName: "star.fill")
                        .foregroundStyle(.yellow)
                        .font(.system(size: 16))
                        .padding(10)
                        .background(.ultraThinMaterial)
                        .clipShape(Circle())
                        .padding(16)
                }
            }
        }
    }

    // MARK: - Stats Row

    private var statsRow: some View {
        HStack(spacing: 0) {
            statItem(
                icon: "chart.bar.fill",
                label: "Yield",
                value: recipe.yieldDescription
            )
            Divider().frame(height: 40)
            statItem(
                icon: "clock",
                label: "Prep",
                value: recipe.formattedPrepTime
            )
            Divider().frame(height: 40)
            statItem(
                icon: "oven.fill",
                label: "Bake",
                value: recipe.formattedBakeTime
            )
            Divider().frame(height: 40)
            statItem(
                icon: "timer",
                label: "Total",
                value: recipe.formattedTotalTime
            )
        }
        .padding(.vertical, 16)
        .bakerlyCard()
    }

    private func statItem(icon: String, label: String, value: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(Color.bakerlyTerracotta)
            Text(value)
                .font(BakerlyFont.subheading(15))
            Text(label)
                .font(BakerlyFont.caption())
                .foregroundStyle(Color.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    // MARK: - Tags

    private var tagsSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(recipe.tags, id: \.self) { tag in
                    TagChip(tag: tag)
                }
            }
        }
    }

    // MARK: - Ingredients

    private var ingredientsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            BakerlySectionHeader(title: "Ingredients",
                                 trailing: "\(recipe.ingredients.count) items")

            ForEach(recipe.sortedIngredients) { ingredient in
                IngredientRow(
                    ingredient: ingredient,
                    showWeight: settings.showWeightInRecipes,
                    unitSystem: settings.unitSystem
                )
                if ingredient.id != recipe.sortedIngredients.last?.id {
                    Divider().padding(.leading, 16)
                }
            }
        }
        .padding(.vertical, 16)
        .bakerlyCard()
    }

    // MARK: - Instructions

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            BakerlySectionHeader(title: "Instructions")

            let steps = recipe.instructions
                .components(separatedBy: "\n")
                .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }

            if steps.count > 1 {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(index + 1)")
                            .font(BakerlyFont.subheading(13))
                            .foregroundStyle(.white)
                            .frame(width: 26, height: 26)
                            .background(Color.bakerlyTerracotta)
                            .clipShape(Circle())
                        Text(step.trimmingCharacters(in: .whitespaces))
                            .font(BakerlyFont.body())
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16)
                }
            } else {
                Text(recipe.instructions)
                    .font(BakerlyFont.body())
                    .padding(.horizontal, 16)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 16)
        .bakerlyCard()
    }

    // MARK: - Notes

    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            BakerlySectionHeader(title: "Notes")
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "note.text")
                    .foregroundStyle(Color.bakerlyGold)
                    .font(.system(size: 16))
                Text(recipe.notes)
                    .font(BakerlyFont.body())
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 16)
        .bakerlyCard()
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                showingCalculator = true
            } label: {
                Label("Scale in Calculator", systemImage: "scalemass.fill")
            }
            .bakerlyPrimaryButton(fullWidth: true)
            .navigationDestination(isPresented: $showingCalculator) {
                FullRecipeCalculatorView(preloadedRecipe: recipe)
            }

            HStack(spacing: 12) {
                Button {
                    showingAddToSchedule = true
                } label: {
                    Label("Add to Schedule", systemImage: "calendar.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .bakerlySecondaryButton()

                Button {
                    toggleFavorite()
                } label: {
                    Label(recipe.isFavorite ? "Unfavorite" : "Favorite",
                          systemImage: recipe.isFavorite ? "star.slash" : "star.fill")
                    .frame(maxWidth: .infinity)
                }
                .bakerlySecondaryButton()
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button { showingEdit = true } label: {
                    Label("Edit Recipe", systemImage: "pencil")
                }
                Button { toggleFavorite() } label: {
                    Label(recipe.isFavorite ? "Remove Favorite" : "Add Favorite",
                          systemImage: recipe.isFavorite ? "star.slash" : "star.fill")
                }
                Button {
                    SwiftDataRepository(modelContext: modelContext)
                    let repo = SwiftDataRepository(modelContext: modelContext)
                    try? repo.duplicateRecipe(recipe)
                } label: {
                    Label("Duplicate", systemImage: "plus.square.on.square")
                }
                Divider()
                Button(role: .destructive) {
                    showingDeleteAlert = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }

    private func toggleFavorite() {
        recipe.isFavorite.toggle()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        try? modelContext.save()
    }
}

// MARK: - IngredientRow

struct IngredientRow: View {
    let ingredient: RecipeIngredient
    var showWeight: Bool = true
    var scaleFactor: Double = 1.0
    var unitSystem: UnitSystem = .us

    private var scaledVolume: Double {
        ingredient.scaledVolumeAmount(by: scaleFactor)
    }

    private var weightInGrams: Double {
        ingredient.scaledWeightInGrams(by: scaleFactor)
    }

    private var weightDisplay: String {
        let unit = unitSystem.preferredWeightUnit
        let converted = weightInGrams / unit.toGrams
        if converted < 0.1 { return "< 0.1 \(unit.abbreviation)" }
        return "\(converted.shortString) \(unit.abbreviation)"
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(ingredient.name)
                    .font(BakerlyFont.subheading(15))
                if !ingredient.notes.isEmpty {
                    Text(ingredient.notes)
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(ingredient.formattedVolume(amount: scaledVolume))
                    .font(BakerlyFont.subheading(15))
                    .foregroundStyle(Color.bakerlyTerracotta)
                if showWeight && ingredient.gramsPerCup > 0 {
                    Text(weightDisplay)
                        .font(BakerlyFont.caption(12))
                        .foregroundStyle(Color.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(ingredient.name): \(ingredient.formattedVolume(amount: scaledVolume))")
    }
}

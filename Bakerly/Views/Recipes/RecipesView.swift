import SwiftUI
import SwiftData
import PhotosUI

// MARK: - RecipesView

struct RecipesView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Recipe.createdAt, order: .reverse) private var recipes: [Recipe]

    @State private var searchText        = ""
    @State private var selectedTags      = Set<String>()
    @State private var viewMode: ViewMode = .grid
    @State private var showingAddRecipe  = false
    @State private var showingFavoritesOnly = false
    @State private var selectedRecipe: Recipe?
    @State private var recipeToDelete: Recipe?
    @State private var showingDeleteAlert = false

    @Environment(\.horizontalSizeClass) private var sizeClass

    enum ViewMode { case grid, list }

    // MARK: - Filtering

    private var allTags: [String] {
        Array(Set(recipes.flatMap(\.tags))).sorted()
    }

    private var filteredRecipes: [Recipe] {
        recipes.filter { recipe in
            let matchesSearch = searchText.isEmpty
                || recipe.name.localizedCaseInsensitiveContains(searchText)
                || recipe.tags.contains { $0.localizedCaseInsensitiveContains(searchText) }
            let matchesTags   = selectedTags.isEmpty
                || !selectedTags.isDisjoint(with: recipe.tags)
            let matchesFav    = !showingFavoritesOnly || recipe.isFavorite
            return matchesSearch && matchesTags && matchesFav
        }
    }

    private var columns: [GridItem] {
        let count = sizeClass == .regular ? 3 : 2
        return Array(repeating: GridItem(.flexible(), spacing: 16), count: count)
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Group {
                if recipes.isEmpty {
                    EmptyStateView.recipes { showingAddRecipe = true }
                } else if filteredRecipes.isEmpty {
                    EmptyStateView.searchResults()
                } else if viewMode == .grid {
                    gridContent
                } else {
                    listContent
                }
            }
            .navigationTitle("Recipes")
            .searchable(text: $searchText, prompt: "Search recipes…")
            .toolbar { toolbar }
            .safeAreaInset(edge: .top) {
                if !allTags.isEmpty {
                    tagFilterBar
                }
            }
            .sheet(isPresented: $showingAddRecipe) {
                AddEditRecipeView()
            }
            .navigationDestination(item: $selectedRecipe) { recipe in
                RecipeDetailView(recipe: recipe)
            }
            .confirmationDialog(
                "Delete Recipe",
                isPresented: $showingDeleteAlert,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let recipe = recipeToDelete {
                        withAnimation { deleteRecipe(recipe) }
                    }
                }
            } message: {
                Text("This will permanently delete \"\(recipeToDelete?.name ?? "this recipe")\".")
            }
        }
    }

    // MARK: - Grid

    private var gridContent: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(filteredRecipes) { recipe in
                    RecipeCardView(recipe: recipe)
                        .onTapGesture { selectedRecipe = recipe }
                        .contextMenu {
                            contextMenuItems(for: recipe)
                        }
                }
            }
            .padding(16)
        }
        .refreshable { /* data is live via @Query */ }
    }

    // MARK: - List

    private var listContent: some View {
        List {
            ForEach(filteredRecipes) { recipe in
                RecipeListRow(recipe: recipe)
                    .contentShape(Rectangle())
                    .onTapGesture { selectedRecipe = recipe }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            recipeToDelete = recipe
                            showingDeleteAlert = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button {
                            toggleFavorite(recipe)
                        } label: {
                            Label(recipe.isFavorite ? "Unfavorite" : "Favorite",
                                  systemImage: recipe.isFavorite ? "star.slash" : "star.fill")
                        }
                        .tint(.bakerlyGold)
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            duplicateRecipe(recipe)
                        } label: {
                            Label("Duplicate", systemImage: "plus.square.on.square")
                        }
                        .tint(.bakerlyBlue)
                    }
            }
        }
        .listStyle(.plain)
        .refreshable { }
    }

    // MARK: - Tag Filter Bar

    private var tagFilterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Favorites toggle
                TagChip(
                    tag: "★ Favorites",
                    isSelected: showingFavoritesOnly,
                    onTap: {
                        withAnimation(.spring(response: 0.3)) {
                            showingFavoritesOnly.toggle()
                        }
                    }
                )
                // All tags
                ForEach(allTags, id: \.self) { tag in
                    TagChip(
                        tag: tag,
                        isSelected: selectedTags.contains(tag),
                        onTap: {
                            withAnimation(.spring(response: 0.3)) {
                                if selectedTags.contains(tag) {
                                    selectedTags.remove(tag)
                                } else {
                                    selectedTags.insert(tag)
                                }
                            }
                        }
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(.ultraThinMaterial)
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                withAnimation { viewMode = viewMode == .grid ? .list : .grid }
            } label: {
                Image(systemName: viewMode == .grid ? "list.bullet" : "square.grid.2x2")
                    .accessibilityLabel(viewMode == .grid ? "Switch to List" : "Switch to Grid")
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                showingAddRecipe = true
            } label: {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
            .accessibilityLabel("Add Recipe")
        }
    }

    // MARK: - Context Menu

    @ViewBuilder
    private func contextMenuItems(for recipe: Recipe) -> some View {
        Button {
            selectedRecipe = recipe
        } label: {
            Label("View Recipe", systemImage: "eye")
        }
        Button {
            toggleFavorite(recipe)
        } label: {
            Label(recipe.isFavorite ? "Remove Favorite" : "Add to Favorites",
                  systemImage: recipe.isFavorite ? "star.slash" : "star.fill")
        }
        Button {
            duplicateRecipe(recipe)
        } label: {
            Label("Duplicate", systemImage: "plus.square.on.square")
        }
        Divider()
        Button(role: .destructive) {
            recipeToDelete = recipe
            showingDeleteAlert = true
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    // MARK: - Actions

    private func toggleFavorite(_ recipe: Recipe) {
        recipe.isFavorite.toggle()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        try? modelContext.save()
    }

    private func deleteRecipe(_ recipe: Recipe) {
        modelContext.delete(recipe)
        try? modelContext.save()
    }

    private func duplicateRecipe(_ recipe: Recipe) {
        let repo = SwiftDataRepository(modelContext: modelContext)
        try? repo.duplicateRecipe(recipe)
    }
}

// MARK: - RecipeCardView (Grid Cell)

struct RecipeCardView: View {
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Image / Placeholder
            ZStack(alignment: .topTrailing) {
                Group {
                    if let data = recipe.imageData, let uiImage = UIImage(data: data) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                    } else {
                        ZStack {
                            Color.bakerlyBeige
                            Image(systemName: "birthday.cake")
                                .font(.system(size: 36))
                                .foregroundStyle(Color.bakerlyTerracotta.opacity(0.4))
                        }
                    }
                }
                .frame(height: 130)
                .clipped()

                if recipe.isFavorite {
                    Image(systemName: "star.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(.yellow)
                        .padding(8)
                        .background(.ultraThinMaterial)
                        .clipShape(Circle())
                        .padding(8)
                }
            }

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(recipe.name)
                    .font(BakerlyFont.subheading(14))
                    .foregroundStyle(Color.primary)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Label(recipe.yieldDescription, systemImage: "chart.bar.fill")
                        .font(BakerlyFont.caption(11))
                        .foregroundStyle(Color.secondary)
                    if recipe.totalTimeMinutes > 0 {
                        Text("·")
                            .foregroundStyle(Color.secondary)
                        Label(recipe.formattedTotalTime, systemImage: "clock")
                            .font(BakerlyFont.caption(11))
                            .foregroundStyle(Color.secondary)
                    }
                }

                if !recipe.tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(recipe.tags.prefix(3), id: \.self) { tag in
                                Text(tag)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(Color.bakerlyTerracotta)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(Color.bakerlyTerracotta.opacity(0.1))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }
            .padding(10)
        }
        .bakerlyCard(cornerRadius: 14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(recipe.name), \(recipe.yieldDescription), \(recipe.formattedTotalTime)")
    }
}

// MARK: - RecipeListRow (List Cell)

struct RecipeListRow: View {
    let recipe: Recipe

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let data = recipe.imageData, let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        Color.bakerlyBeige
                        Image(systemName: "birthday.cake")
                            .foregroundStyle(Color.bakerlyTerracotta.opacity(0.5))
                    }
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(recipe.name)
                        .font(BakerlyFont.subheading())
                    Spacer()
                    if recipe.isFavorite {
                        Image(systemName: "star.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(.yellow)
                    }
                }
                Text(recipe.yieldDescription)
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                if !recipe.tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(recipe.tags.prefix(3), id: \.self) { tag in
                            Text(tag)
                                .font(.system(size: 10))
                                .foregroundStyle(Color.bakerlyTerracotta)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.bakerlyTerracotta.opacity(0.1))
                                .clipShape(Capsule())
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

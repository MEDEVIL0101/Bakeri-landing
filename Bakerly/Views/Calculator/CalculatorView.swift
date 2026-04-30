import SwiftUI

// MARK: - CalculatorView (Tab Container)

struct CalculatorView: View {
    enum Mode: String, CaseIterable {
        case quickConverter = "Quick Convert"
        case fullRecipe     = "Recipe Scaler"
    }

    @State private var selectedMode: Mode = .quickConverter
    var preloadedRecipe: Recipe? = nil

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Mode picker
                Picker("Calculator Mode", selection: $selectedMode) {
                    ForEach(Mode.allCases, id: \.self) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Color(.systemBackground))

                Divider()

                // Content
                Group {
                    switch selectedMode {
                    case .quickConverter:
                        QuickConverterView()
                    case .fullRecipe:
                        FullRecipeCalculatorView(preloadedRecipe: preloadedRecipe)
                    }
                }
                .transition(.opacity)
            }
            .navigationTitle("Calculator")
            .navigationBarTitleDisplayMode(.large)
            .onAppear {
                if preloadedRecipe != nil {
                    selectedMode = .fullRecipe
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: selectedMode)
    }
}

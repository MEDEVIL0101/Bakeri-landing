import SwiftUI

// MARK: - EmptyStateView
// Reusable component shown when a list/grid has no content.

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            ZStack {
                Circle()
                    .fill(Color.bakerlyTerracotta.opacity(0.1))
                    .frame(width: 100, height: 100)
                Image(systemName: icon)
                    .font(.system(size: 44))
                    .foregroundStyle(Color.bakerlyTerracotta.opacity(0.7))
            }

            VStack(spacing: 8) {
                Text(title)
                    .font(BakerlyFont.heading(20))
                    .foregroundStyle(Color.primary)
                    .multilineTextAlignment(.center)

                Text(message)
                    .font(BakerlyFont.body())
                    .foregroundStyle(Color.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            if let actionTitle = actionTitle, let action = action {
                Button(action: action) {
                    Text(actionTitle)
                }
                .bakerlyPrimaryButton()
                .padding(.top, 8)
            }

            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title). \(message)")
    }
}

// MARK: - Common Empty States

extension EmptyStateView {
    static func recipes(action: @escaping () -> Void) -> EmptyStateView {
        EmptyStateView(
            icon: "book.closed.fill",
            title: "No Recipes Yet",
            message: "Add your first recipe to build your digital baking library.",
            actionTitle: "Add Recipe",
            action: action
        )
    }

    static func orders(action: @escaping () -> Void) -> EmptyStateView {
        EmptyStateView(
            icon: "shippingbox.fill",
            title: "No Orders",
            message: "Start tracking your bakery orders and customer requests.",
            actionTitle: "New Order",
            action: action
        )
    }

    static func schedule(action: @escaping () -> Void) -> EmptyStateView {
        EmptyStateView(
            icon: "calendar.badge.clock",
            title: "Nothing Scheduled",
            message: "Your baking schedule is clear. Add tasks to stay organized.",
            actionTitle: "Add Task",
            action: action
        )
    }

    static func searchResults() -> EmptyStateView {
        EmptyStateView(
            icon: "magnifyingglass",
            title: "No Results",
            message: "Try different keywords or clear your search."
        )
    }
}

// MARK: - LoadingView

struct BakerlyLoadingView: View {
    var message: String = "Loading…"
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(Color.bakerlyTerracotta)
                .scaleEffect(1.4)
            Text(message)
                .font(BakerlyFont.body())
                .foregroundStyle(Color.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - ErrorView

struct BakerlyErrorView: View {
    let message: String
    var retry: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color.bakerlyRed)
            Text(message)
                .font(BakerlyFont.body())
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.secondary)
                .padding(.horizontal)
            if let retry = retry {
                Button("Try Again", action: retry)
                    .bakerlySecondaryButton()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

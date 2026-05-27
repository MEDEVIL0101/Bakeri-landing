import SwiftUI

// MARK: - MainTabView

struct MainTabView: View {
    @State private var selectedTab: Tab = .schedule
    @Environment(\.horizontalSizeClass) private var sizeClass

    enum Tab: Int, CaseIterable {
        case schedule   = 0
        case orders     = 1
        case recipes    = 2
        case calculator = 3

        var title: String {
            switch self {
            case .schedule:   return "Schedule"
            case .orders:     return "Orders"
            case .recipes:    return "Recipes"
            case .calculator: return "Calculator"
            }
        }

        var icon: String {
            switch self {
            case .schedule:   return "calendar"
            case .orders:     return "shippingbox.fill"
            case .recipes:    return "book.fill"
            case .calculator: return "scalemass.fill"
            }
        }
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            ScheduleView()
                .tabItem {
                    Label(Tab.schedule.title, systemImage: Tab.schedule.icon)
                }
                .tag(Tab.schedule)

            OrdersView()
                .tabItem {
                    Label(Tab.orders.title, systemImage: Tab.orders.icon)
                }
                .tag(Tab.orders)

            RecipesView()
                .tabItem {
                    Label(Tab.recipes.title, systemImage: Tab.recipes.icon)
                }
                .tag(Tab.recipes)

            CalculatorView()
                .tabItem {
                    Label(Tab.calculator.title, systemImage: Tab.calculator.icon)
                }
                .tag(Tab.calculator)
        }
        .tint(Color.bakerlyTerracotta)
    }
}

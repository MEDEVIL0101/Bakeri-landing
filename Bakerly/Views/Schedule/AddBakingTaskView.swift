import SwiftUI
import SwiftData

// MARK: - AddBakingTaskView

struct AddBakingTaskView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss)      private var dismiss
    @Query(sort: \Recipe.name) private var recipes: [Recipe]
    @Query(sort: \Order.dueDate) private var orders: [Order]

    var preselectedRecipe: Recipe? = nil
    var preselectedDate: Date?     = nil
    var existingTask: BakingTask?  = nil

    @State private var title       = ""
    @State private var dueDate     = Date()
    @State private var notes       = ""
    @State private var linkedRecipe: Recipe? = nil
    @State private var linkedOrder: Order?   = nil
    @State private var showingRecipePicker   = false
    @State private var showingOrderPicker    = false
    @FocusState private var titleFocused: Bool

    private var isEditing: Bool { existingTask != nil }

    var body: some View {
        NavigationStack {
            Form {
                // Title
                Section("Task") {
                    HStack {
                        Image(systemName: "checklist")
                            .foregroundStyle(Color.bakerlyTerracotta)
                        TextField("What needs to be done?", text: $title)
                            .focused($titleFocused)
                            .submitLabel(.next)
                    }
                    DatePicker("Date & Time", selection: $dueDate, displayedComponents: [.date, .hourAndMinute])
                        .tint(Color.bakerlyTerracotta)
                }

                // Links
                Section("Links (optional)") {
                    // Recipe link
                    if let recipe = linkedRecipe {
                        HStack {
                            Image(systemName: "book.fill").foregroundStyle(Color.bakerlyGold)
                            Text(recipe.name)
                            Spacer()
                            Button {
                                linkedRecipe = nil
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Color.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        Button {
                            showingRecipePicker = true
                        } label: {
                            Label("Link to Recipe", systemImage: "book")
                                .foregroundStyle(Color.bakerlyTerracotta)
                        }
                    }

                    // Order link
                    if let order = linkedOrder {
                        HStack {
                            Image(systemName: "shippingbox.fill").foregroundStyle(Color.bakerlyOrange)
                            Text(order.customerName)
                            Spacer()
                            Button {
                                linkedOrder = nil
                            } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(Color.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    } else {
                        Button {
                            showingOrderPicker = true
                        } label: {
                            Label("Link to Order", systemImage: "shippingbox")
                                .foregroundStyle(Color.bakerlyTerracotta)
                        }
                    }
                }

                // Notes
                Section("Notes") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 80)
                        .overlay(alignment: .topLeading) {
                            if notes.isEmpty {
                                Text("Additional notes…")
                                    .font(BakerlyFont.body())
                                    .foregroundStyle(Color.secondary.opacity(0.6))
                                    .padding(.top, 8).padding(.leading, 4)
                                    .allowsHitTesting(false)
                            }
                        }
                }
            }
            .navigationTitle(isEditing ? "Edit Task" : "New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .onAppear { populate() }
            .sheet(isPresented: $showingRecipePicker) {
                pickerSheet(title: "Pick Recipe") {
                    ForEach(recipes) { recipe in
                        Button {
                            linkedRecipe = recipe
                            if title.isEmpty { title = "Bake \(recipe.name)" }
                            showingRecipePicker = false
                        } label: {
                            HStack {
                                Text(recipe.name).foregroundStyle(Color.primary)
                                Spacer()
                                if linkedRecipe?.id == recipe.id {
                                    Image(systemName: "checkmark").foregroundStyle(Color.bakerlyTerracotta)
                                }
                            }
                        }
                    }
                }
            }
            .sheet(isPresented: $showingOrderPicker) {
                pickerSheet(title: "Pick Order") {
                    ForEach(orders.filter { $0.status.isActive }) { order in
                        Button {
                            linkedOrder = order
                            if title.isEmpty { title = "Prepare order for \(order.customerName)" }
                            showingOrderPicker = false
                        } label: {
                            VStack(alignment: .leading) {
                                Text(order.customerName).foregroundStyle(Color.primary)
                                Text(order.dueDate.relativeDisplay)
                                    .font(BakerlyFont.caption())
                                    .foregroundStyle(Color.secondary)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("Save") { save() }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(title.trimmingCharacters(in: .whitespaces).isEmpty
                                 ? Color.secondary : Color.bakerlyTerracotta)
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        ToolbarItem(placement: .keyboard) {
            Button("Done") { titleFocused = false }
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: - Helper Views

    @ViewBuilder
    private func pickerSheet<Content: View>(title: String, @ViewBuilder content: @escaping () -> Content) -> some View {
        NavigationStack {
            List { content() }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Cancel") {
                            showingRecipePicker = false
                            showingOrderPicker  = false
                        }
                    }
                }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: - Logic

    private func populate() {
        if let task = existingTask {
            title        = task.title
            dueDate      = task.dueDate
            notes        = task.notes
            linkedRecipe = task.recipe
            linkedOrder  = task.order
        } else {
            if let recipe = preselectedRecipe {
                linkedRecipe = recipe
                title = "Bake \(recipe.name)"
            }
            if let date = preselectedDate {
                // Keep the time component; only set the date portion
                var comps = Calendar.current.dateComponents([.hour, .minute], from: dueDate)
                let dayComps = Calendar.current.dateComponents([.year, .month, .day], from: date)
                comps.year = dayComps.year
                comps.month = dayComps.month
                comps.day = dayComps.day
                dueDate = Calendar.current.date(from: comps) ?? date
            }
            titleFocused = true
        }
    }

    private func save() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        let target = existingTask ?? BakingTask(title: "")
        target.title       = title.trimmingCharacters(in: .whitespaces)
        target.dueDate     = dueDate
        target.notes       = notes
        target.recipe      = linkedRecipe
        target.order       = linkedOrder

        if existingTask == nil {
            modelContext.insert(target)
        }
        try? modelContext.save()

        // Schedule notification
        Task {
            await NotificationService.shared.scheduleBakingTaskReminder(for: target)
        }

        dismiss()
    }
}

import SwiftUI
import SwiftData

// MARK: - AddEditOrderView

struct AddEditOrderView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss)      private var dismiss
    @Query(sort: \Recipe.name) private var recipes: [Recipe]

    var order: Order? = nil

    // MARK: - Form State
    @State private var customerName  = ""
    @State private var customerPhone = ""
    @State private var customerEmail = ""
    @State private var dueDate       = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
    @State private var status        = OrderStatus.new
    @State private var notes         = ""
    @State private var isPaid        = false
    @State private var items: [DraftItem] = [DraftItem()]
    @State private var showingDiscardAlert = false
    @FocusState private var focusedField: FormField?

    enum FormField: Hashable {
        case name, phone, email, notes
    }

    // MARK: - Draft Item

    struct DraftItem: Identifiable {
        let id = UUID()
        var customName   = ""
        var recipe: Recipe? = nil
        var quantity     = "1"
        var unit         = YieldUnit.pieces
        var pricePerUnit = ""
        var notes        = ""

        var displayName: String {
            !customName.isEmpty ? customName : (recipe?.name ?? "")
        }

        var lineTotal: Double {
            (Double(quantity) ?? 0) * (Double(pricePerUnit) ?? 0)
        }
    }

    private var isEditing: Bool { order != nil }

    private var subtotal: Double {
        items.reduce(0) { $0 + $1.lineTotal }
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                customerSection
                itemsSection
                orderDetailsSection
                paymentSection
            }
            .navigationTitle(isEditing ? "Edit Order" : "New Order")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .onAppear { populateIfEditing() }
            .confirmationDialog("Discard Changes?", isPresented: $showingDiscardAlert) {
                Button("Discard", role: .destructive) { dismiss() }
            }
        }
    }

    // MARK: - Customer Section

    private var customerSection: some View {
        Section {
            HStack {
                Image(systemName: "person.fill").foregroundStyle(Color.bakerlyTerracotta).frame(width: 24)
                TextField("Customer Name *", text: $customerName)
                    .focused($focusedField, equals: .name)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .phone }
            }
            HStack {
                Image(systemName: "phone.fill").foregroundStyle(Color.bakerlyTerracotta).frame(width: 24)
                TextField("Phone", text: $customerPhone)
                    .keyboardType(.phonePad)
                    .focused($focusedField, equals: .phone)
            }
            HStack {
                Image(systemName: "envelope.fill").foregroundStyle(Color.bakerlyTerracotta).frame(width: 24)
                TextField("Email", text: $customerEmail)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .focused($focusedField, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focusedField = nil }
            }
        } header: {
            Text("Customer")
        }
    }

    // MARK: - Items Section

    private var itemsSection: some View {
        Section {
            ForEach($items) { $item in
                OrderItemFormRow(item: $item, recipes: recipes)
            }
            .onDelete { items.remove(atOffsets: $0) }

            Button {
                items.append(DraftItem())
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                Label("Add Item", systemImage: "plus.circle.fill")
                    .foregroundStyle(Color.bakerlyTerracotta)
            }

            // Subtotal
            HStack {
                Text("Subtotal")
                    .font(BakerlyFont.subheading())
                Spacer()
                Text(subtotal.asCurrency)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
            .padding(.vertical, 4)
        } header: {
            Text("Order Items")
        }
    }

    // MARK: - Order Details

    private var orderDetailsSection: some View {
        Section("Order Details") {
            DatePicker("Due Date & Time", selection: $dueDate, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                .tint(Color.bakerlyTerracotta)

            Picker("Status", selection: $status) {
                ForEach(OrderStatus.allCases) { s in
                    Label(s.rawValue, systemImage: s.sfSymbol).tag(s)
                }
            }
            .tint(Color.bakerlyTerracotta)

            HStack {
                Image(systemName: "note.text").foregroundStyle(Color.bakerlyGold).frame(width: 24)
                TextField("Notes", text: $notes, axis: .vertical)
                    .lineLimit(3...)
                    .focused($focusedField, equals: .notes)
            }
        }
    }

    // MARK: - Payment Section

    private var paymentSection: some View {
        Section("Payment") {
            Toggle(isOn: $isPaid) {
                Label("Paid", systemImage: "checkmark.seal.fill")
                    .foregroundStyle(isPaid ? Color.bakerlyBlue : Color.primary)
            }
            .tint(Color.bakerlyBlue)
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Cancel") { showingDiscardAlert = true }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("Save") { saveOrder() }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(customerName.trimmingCharacters(in: .whitespaces).isEmpty
                                 ? Color.secondary : Color.bakerlyTerracotta)
                .disabled(customerName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        ToolbarItem(placement: .keyboard) {
            Button("Done") { focusedField = nil }
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: - Logic

    private func populateIfEditing() {
        guard let order = order else { return }
        customerName  = order.customerName
        customerPhone = order.customerPhone
        customerEmail = order.customerEmail
        dueDate       = order.dueDate
        status        = order.status
        notes         = order.notes
        isPaid        = order.isPaid
        items = order.sortedItems.map { item in
            var d = DraftItem()
            d.customName   = item.customName
            d.recipe       = item.recipe
            d.quantity     = item.quantity.cleanString
            d.unit         = item.unit
            d.pricePerUnit = item.pricePerUnit > 0 ? item.pricePerUnit.cleanString : ""
            d.notes        = item.notes
            return d
        }
    }

    private func saveOrder() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        let target = order ?? Order(customerName: "")
        target.customerName  = customerName.trimmingCharacters(in: .whitespaces)
        target.customerPhone = customerPhone
        target.customerEmail = customerEmail
        target.dueDate       = dueDate
        target.status        = status
        target.notes         = notes
        target.isPaid        = isPaid

        // Rebuild items
        target.orderItems.forEach { modelContext.delete($0) }
        target.orderItems = []
        for draft in items {
            let name = draft.customName.trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty || draft.recipe != nil else { continue }
            let item = OrderItem(
                customName: name,
                quantity: Double(draft.quantity) ?? 1,
                unit: draft.unit,
                pricePerUnit: Double(draft.pricePerUnit) ?? 0,
                notes: draft.notes
            )
            item.recipe = draft.recipe
            target.orderItems.append(item)
        }

        if order == nil {
            modelContext.insert(target)
        }
        try? modelContext.save()

        // Schedule notifications
        Task {
            await NotificationService.shared.scheduleOrderReminders(for: target)
        }

        dismiss()
    }
}

// MARK: - OrderItemFormRow

struct OrderItemFormRow: View {
    @Binding var item: AddEditOrderView.DraftItem
    let recipes: [Recipe]
    @State private var showingRecipePicker = false

    var body: some View {
        VStack(spacing: 8) {
            // Name / Recipe selector
            HStack {
                if let recipe = item.recipe {
                    HStack {
                        Image(systemName: "book.fill").foregroundStyle(Color.bakerlyTerracotta).font(.system(size: 12))
                        Text(recipe.name).font(BakerlyFont.body())
                        Spacer()
                        Button { item.recipe = nil } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Color.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    HStack {
                        TextField("Item name", text: $item.customName)
                            .font(BakerlyFont.body())
                        if !recipes.isEmpty {
                            Button {
                                showingRecipePicker = true
                            } label: {
                                Image(systemName: "book")
                                    .foregroundStyle(Color.bakerlyTerracotta)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            // Quantity + Price
            HStack(spacing: 12) {
                HStack {
                    Text("Qty")
                        .font(BakerlyFont.caption())
                        .foregroundStyle(Color.secondary)
                    TextField("1", text: $item.quantity)
                        .keyboardType(.decimalPad)
                        .frame(width: 50)
                }
                Picker("", selection: $item.unit) {
                    ForEach(YieldUnit.allCases) { u in Text(u.rawValue).tag(u) }
                }
                .pickerStyle(.menu)
                .tint(Color.bakerlyTerracotta)
                .frame(width: 80)
                Spacer()
                HStack {
                    Text("$")
                        .font(BakerlyFont.body())
                        .foregroundStyle(Color.secondary)
                    TextField("0.00", text: $item.pricePerUnit)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                }
            }

            // Line total preview
            if item.lineTotal > 0 {
                HStack {
                    Spacer()
                    Text("= \(item.lineTotal.asCurrency)")
                        .font(BakerlyFont.caption(12))
                        .foregroundStyle(Color.bakerlyTerracotta)
                }
            }
        }
        .sheet(isPresented: $showingRecipePicker) {
            NavigationStack {
                List(recipes) { recipe in
                    Button {
                        item.recipe = recipe
                        if item.customName.isEmpty { item.customName = recipe.name }
                        showingRecipePicker = false
                    } label: {
                        Text(recipe.name).foregroundStyle(Color.primary)
                    }
                }
                .navigationTitle("Pick Recipe")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Cancel") { showingRecipePicker = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }
}

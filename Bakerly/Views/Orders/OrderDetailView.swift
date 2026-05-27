import SwiftUI
import SwiftData

// MARK: - OrderDetailView

struct OrderDetailView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss)      private var dismiss
    @Bindable var order: Order
    @EnvironmentObject private var settings: UserSettings

    @State private var showingEdit          = false
    @State private var showingDeleteAlert   = false
    @State private var showingStatusPicker  = false
    @State private var showingPaymentSheet  = false
    @State private var paymentNote          = ""
    @State private var showingCalculator    = false
    @State private var calculatorRecipe: Recipe? = nil

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Header card
                headerCard
                // Status progression
                statusCard
                // Items list
                itemsCard
                // Customer info
                customerCard
                // Notes
                if !order.notes.isEmpty {
                    notesCard
                }
                // Baking tasks
                if !order.bakingTasks.isEmpty {
                    bakingTasksCard
                }
                // Payment
                paymentCard
            }
            .padding(16)
        }
        .navigationTitle(order.customerName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .sheet(isPresented: $showingEdit) {
            AddEditOrderView(order: order)
        }
        .sheet(isPresented: $showingPaymentSheet) {
            paymentSheet
        }
        .navigationDestination(isPresented: $showingCalculator) {
            if let recipe = calculatorRecipe {
                FullRecipeCalculatorView(preloadedRecipe: recipe)
            }
        }
        .confirmationDialog("Delete Order", isPresented: $showingDeleteAlert, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                modelContext.delete(order)
                try? modelContext.save()
                dismiss()
            }
        } message: {
            Text("This cannot be undone.")
        }
    }

    // MARK: - Header Card

    private var headerCard: some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.customerName)
                        .font(BakerlyFont.display(26))
                    if !order.customerPhone.isEmpty {
                        Label(order.customerPhone, systemImage: "phone")
                            .font(BakerlyFont.caption())
                            .foregroundStyle(Color.secondary)
                    }
                    if !order.customerEmail.isEmpty {
                        Label(order.customerEmail, systemImage: "envelope")
                            .font(BakerlyFont.caption())
                            .foregroundStyle(Color.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    Text(order.formattedTotal)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.bakerlyTerracotta)
                    StatusPill(status: order.status)
                }
            }

            Divider()

            HStack {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Due")
                            .font(BakerlyFont.caption())
                            .foregroundStyle(Color.secondary)
                        Text(order.dueDate.relativeWithTime)
                            .font(BakerlyFont.subheading(14))
                            .foregroundStyle(order.isOverdue ? Color.bakerlyRed : Color.primary)
                    }
                } icon: {
                    Image(systemName: "calendar.badge.clock")
                        .foregroundStyle(order.isOverdue ? Color.bakerlyRed : Color.bakerlyOrange)
                }

                Spacer()

                if order.isPaid {
                    Label("Paid", systemImage: "checkmark.seal.fill")
                        .font(BakerlyFont.subheading(14))
                        .foregroundStyle(Color.bakerlyBlue)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.bakerlyBlue.opacity(0.12))
                        .clipShape(Capsule())
                }
            }
        }
        .padding(16)
        .bakerlyCard()
    }

    // MARK: - Status Card

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            BakerlySectionHeader(title: "Status")

            // Status progress bar
            HStack(spacing: 4) {
                ForEach(OrderStatus.allCases.filter { $0 != .cancelled }, id: \.self) { status in
                    let isActive = statusIndex(status) <= statusIndex(order.status)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(isActive ? status.statusColor : Color.bakerlyGray1)
                        .frame(height: 6)
                        .animation(.spring(response: 0.4), value: order.status)
                }
            }
            .padding(.horizontal, 16)

            // Status picker
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(OrderStatus.allCases) { status in
                        Button {
                            withAnimation {
                                order.status = status
                                try? modelContext.save()
                            }
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: status.sfSymbol)
                                    .font(.system(size: 12))
                                Text(status.rawValue)
                                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                            }
                            .foregroundStyle(order.status == status ? .white : status.statusColor)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(order.status == status
                                ? status.statusColor
                                : status.statusBgColor)
                            .clipShape(Capsule())
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 4)
            }
        }
        .padding(.vertical, 12)
        .bakerlyCard()
    }

    private func statusIndex(_ status: OrderStatus) -> Int {
        let order: [OrderStatus] = [.new, .confirmed, .baking, .ready, .delivered]
        return order.firstIndex(of: status) ?? 0
    }

    // MARK: - Items Card

    private var itemsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            BakerlySectionHeader(
                title: "Order Items",
                trailing: "\(order.orderItems.count) items"
            )
            .padding(.bottom, 8)

            ForEach(order.sortedItems) { item in
                VStack(spacing: 0) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.displayName)
                                .font(BakerlyFont.subheading(15))
                            Text("\(item.quantity.cleanString) × \(item.pricePerUnit.asCurrency)")
                                .font(BakerlyFont.caption())
                                .foregroundStyle(Color.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 3) {
                            Text(item.formattedLineTotal)
                                .font(BakerlyFont.subheading(15))
                                .foregroundStyle(Color.bakerlyTerracotta)
                            if let recipe = item.recipe {
                                Button {
                                    calculatorRecipe = recipe
                                    showingCalculator = true
                                } label: {
                                    Label("Scale", systemImage: "scalemass")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(Color.bakerlyBlue)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    if item.id != order.sortedItems.last?.id {
                        Divider().padding(.leading, 16)
                    }
                }
            }

            Divider()

            // Total row
            HStack {
                Text("Total")
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                Spacer()
                Text(order.formattedTotal)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .padding(.vertical, 4)
        .bakerlyCard()
    }

    // MARK: - Customer Card

    private var customerCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            BakerlySectionHeader(title: "Customer")

            VStack(spacing: 10) {
                if !order.customerPhone.isEmpty {
                    Link(destination: URL(string: "tel:\(order.customerPhone.filter { $0.isNumber })")!) {
                        customerInfoRow(icon: "phone.fill", label: "Phone", value: order.customerPhone)
                    }
                    .foregroundStyle(Color.primary)
                }
                if !order.customerEmail.isEmpty {
                    Link(destination: URL(string: "mailto:\(order.customerEmail)")!) {
                        customerInfoRow(icon: "envelope.fill", label: "Email", value: order.customerEmail)
                    }
                    .foregroundStyle(Color.primary)
                }
                if order.customerPhone.isEmpty && order.customerEmail.isEmpty {
                    Text("No contact info")
                        .font(BakerlyFont.body())
                        .foregroundStyle(Color.secondary)
                        .padding(.horizontal, 16)
                }
            }
        }
        .padding(.vertical, 12)
        .bakerlyCard()
    }

    private func customerInfoRow(icon: String, label: String, value: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Color.bakerlyTerracotta)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                Text(value)
                    .font(BakerlyFont.body())
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12))
                .foregroundStyle(Color.secondary)
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Notes Card

    private var notesCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            BakerlySectionHeader(title: "Notes")
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "note.text")
                    .foregroundStyle(Color.bakerlyGold)
                Text(order.notes)
                    .font(BakerlyFont.body())
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 12)
        .bakerlyCard()
    }

    // MARK: - Baking Tasks Card

    private var bakingTasksCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            BakerlySectionHeader(title: "Baking Tasks")
            ForEach(order.bakingTasks.sorted(by: { $0.dueDate < $1.dueDate })) { task in
                HStack {
                    Button {
                        task.isCompleted.toggle()
                        try? modelContext.save()
                    } label: {
                        Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(task.isCompleted ? Color.bakerlyBlue : Color.bakerlyGray3)
                    }
                    .buttonStyle(.plain)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(task.title)
                            .font(BakerlyFont.body())
                            .strikethrough(task.isCompleted)
                        Text(task.dueDate.relativeWithTime)
                            .font(BakerlyFont.caption(12))
                            .foregroundStyle(Color.secondary)
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
        }
        .padding(.vertical, 8)
        .bakerlyCard()
    }

    // MARK: - Payment Card

    private var paymentCard: some View {
        VStack(spacing: 12) {
            Button {
                if !order.isPaid {
                    showingPaymentSheet = true
                } else {
                    order.isPaid = false
                    order.paymentNote = ""
                    try? modelContext.save()
                }
            } label: {
                HStack {
                    Image(systemName: order.isPaid ? "checkmark.seal.fill" : "dollarsign.circle.fill")
                    Text(order.isPaid ? "Mark as Unpaid" : "Mark as Paid")
                }
                .frame(maxWidth: .infinity)
            }
            .bakerlyPrimaryButton(fullWidth: true)
            .tint(order.isPaid ? Color.bakerlyGray3 : Color.bakerlyBlue)

            if !order.paymentNote.isEmpty {
                HStack {
                    Image(systemName: "note.text").foregroundStyle(Color.secondary)
                    Text(order.paymentNote).font(BakerlyFont.caption()).foregroundStyle(Color.secondary)
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: - Payment Sheet

    private var paymentSheet: some View {
        NavigationStack {
            Form {
                Section("Payment Note (optional)") {
                    TextField("e.g. Cash, Venmo, etc.", text: $paymentNote)
                }
            }
            .navigationTitle("Mark as Paid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { showingPaymentSheet = false }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Confirm") {
                        order.isPaid = true
                        order.paymentNote = paymentNote
                        try? modelContext.save()
                        showingPaymentSheet = false
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.height(220)])
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button { showingEdit = true } label: {
                    Label("Edit Order", systemImage: "pencil")
                }
                Divider()
                Button(role: .destructive) {
                    showingDeleteAlert = true
                } label: {
                    Label("Delete Order", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }
}

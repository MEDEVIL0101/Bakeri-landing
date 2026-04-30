import SwiftUI
import SwiftData

// MARK: - ScheduleView

struct ScheduleView: View {
    @Environment(\.modelContext)  private var modelContext
    @Query(sort: \BakingTask.dueDate) private var tasks: [BakingTask]
    @Query(sort: \Order.dueDate)      private var orders: [Order]
    @EnvironmentObject private var settings: UserSettings

    @State private var selectedDate     = Date()
    @State private var showingAddTask   = false
    @State private var selectedTask: BakingTask?    = nil
    @State private var taskToDelete: BakingTask?    = nil
    @State private var showingDeleteAlert           = false
    @State private var showingCalculator            = false

    // MARK: - Computed

    private var todayOrders: [Order] {
        orders.filter { $0.isDueToday && $0.status.isActive }
    }

    private var ordersForSelectedDate: [Order] {
        orders.filter {
            Calendar.current.isDate($0.dueDate, inSameDayAs: selectedDate) && $0.status.isActive
        }
    }

    private var tasksForSelectedDate: [BakingTask] {
        tasks.filter {
            Calendar.current.isDate($0.dueDate, inSameDayAs: selectedDate) && !$0.isCompleted
        }
    }

    private var upcomingTasks: [BakingTask] {
        let end = Calendar.current.date(byAdding: .day, value: 8, to: Calendar.current.startOfDay(for: Date())) ?? Date()
        return tasks.filter { $0.dueDate > Calendar.current.startOfDay(for: Date()).addingTimeInterval(86400) && $0.dueDate < end && !$0.isCompleted }
    }

    private var upcomingOrders: [Order] {
        let tomorrow = Calendar.current.startOfDay(for: Date()).addingTimeInterval(86400)
        let weekOut  = Calendar.current.date(byAdding: .day, value: 8, to: Calendar.current.startOfDay(for: Date())) ?? Date()
        return orders.filter { $0.dueDate >= tomorrow && $0.dueDate < weekOut && $0.status.isActive }
    }

    private var selectedDateLabel: String {
        let cal = Calendar.current
        if cal.isDateInToday(selectedDate)     { return "Today" }
        if cal.isDateInTomorrow(selectedDate)  { return "Tomorrow" }
        let fmt = DateFormatter()
        fmt.dateFormat = "EEEE, MMM d"
        return fmt.string(from: selectedDate)
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Horizontal date strip
                    dateStripSection

                    // Today's summary banner
                    if Calendar.current.isDateInToday(selectedDate) {
                        todaySummaryBanner
                    }

                    // Selected day content
                    if tasksForSelectedDate.isEmpty && ordersForSelectedDate.isEmpty {
                        if Calendar.current.isDateInToday(selectedDate) {
                            EmptyStateView(
                                icon: "sun.max.fill",
                                title: "All Clear Today!",
                                message: "Nothing scheduled. Add a task or check your orders.",
                                actionTitle: "Add Task"
                            ) { showingAddTask = true }
                            .frame(height: 280)
                        } else {
                            emptyDateCard
                        }
                    } else {
                        selectedDayContent
                    }

                    // Upcoming section
                    if !upcomingTasks.isEmpty || !upcomingOrders.isEmpty {
                        upcomingSection
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 100)
            }
            .navigationTitle("Schedule")
            .toolbar { toolbar }
            .sheet(isPresented: $showingAddTask) {
                AddBakingTaskView(preselectedDate: selectedDate)
            }
            .sheet(item: $selectedTask) { task in
                TaskDetailSheet(task: task)
            }
            .confirmationDialog("Delete Task", isPresented: $showingDeleteAlert, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let task = taskToDelete {
                        modelContext.delete(task)
                        try? modelContext.save()
                    }
                }
            } message: {
                Text("This cannot be undone.")
            }
        }
    }

    // MARK: - Date Strip

    private var dateStripSection: some View {
        let days = (-1...13).compactMap { offset in
            Calendar.current.date(byAdding: .day, value: offset, to: Calendar.current.startOfDay(for: Date()))
        }

        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(days, id: \.self) { day in
                        DateStripCell(
                            date: day,
                            isSelected: Calendar.current.isDate(day, inSameDayAs: selectedDate),
                            hasItems: dayHasItems(day)
                        )
                        .onTapGesture {
                            withAnimation(.spring(response: 0.3)) {
                                selectedDate = day
                            }
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        }
                        .id(day)
                    }
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 2)
            }
            .onAppear {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    proxy.scrollTo(Calendar.current.startOfDay(for: Date()), anchor: .center)
                }
            }
        }
    }

    private func dayHasItems(_ date: Date) -> Bool {
        tasks.contains { Calendar.current.isDate($0.dueDate, inSameDayAs: date) && !$0.isCompleted }
        || orders.contains { Calendar.current.isDate($0.dueDate, inSameDayAs: date) && $0.status.isActive }
    }

    // MARK: - Today Banner

    private var todaySummaryBanner: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Today's Baking")
                    .font(BakerlyFont.subheading(18))
                Text("\(todayOrders.count) orders due · \(tasksForSelectedDate.count) tasks")
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
            }
            Spacer()
            if !todayOrders.isEmpty {
                Button {
                    showingCalculator = true
                } label: {
                    Label("Calculator", systemImage: "scalemass.fill")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                }
                .bakerlySecondaryButton()
                .navigationDestination(isPresented: $showingCalculator) {
                    CalculatorView()
                }
            }
        }
        .padding(16)
        .background(
            LinearGradient(
                colors: [Color.bakerlyTerracotta, Color.bakerlyOrange],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .foregroundStyle(.white)
    }

    // MARK: - Selected Day Content

    private var selectedDayContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(selectedDateLabel)
                .font(BakerlyFont.subheading())
                .foregroundStyle(Color.secondary)
                .padding(.top, 4)

            // Orders for this day
            if !ordersForSelectedDate.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Orders Due", systemImage: "shippingbox.fill")
                        .font(BakerlyFont.subheading(14))
                        .foregroundStyle(Color.bakerlyOrange)
                    ForEach(ordersForSelectedDate) { order in
                        ScheduleOrderRow(order: order)
                    }
                }
            }

            // Tasks for this day
            if !tasksForSelectedDate.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Baking Tasks", systemImage: "checklist")
                        .font(BakerlyFont.subheading(14))
                        .foregroundStyle(Color.bakerlyBlue)
                    ForEach(tasksForSelectedDate) { task in
                        ScheduleTaskRow(task: task) {
                            selectedTask = task
                        } onComplete: {
                            task.isCompleted = true
                            try? modelContext.save()
                        } onDelete: {
                            taskToDelete = task
                            showingDeleteAlert = true
                        }
                    }
                }
            }
        }
    }

    // MARK: - Empty Date Card

    private var emptyDateCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar.badge.checkmark")
                .font(.system(size: 36))
                .foregroundStyle(Color.bakerlyGray2)
            Text("Nothing on \(selectedDateLabel)")
                .font(BakerlyFont.subheading())
                .foregroundStyle(Color.secondary)
            Button("Add Task") { showingAddTask = true }
                .bakerlySecondaryButton()
        }
        .frame(maxWidth: .infinity)
        .padding(32)
        .bakerlyCard()
    }

    // MARK: - Upcoming Section

    private var upcomingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            BakerlySectionHeader(title: "Upcoming (Next 7 Days)")

            ForEach(upcomingOrders) { order in
                ScheduleOrderRow(order: order)
            }
            ForEach(upcomingTasks) { task in
                ScheduleTaskRow(task: task) {
                    selectedTask = task
                } onComplete: {
                    task.isCompleted = true
                    try? modelContext.save()
                } onDelete: {
                    taskToDelete = task
                    showingDeleteAlert = true
                }
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                showingAddTask = true
            } label: {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(Color.bakerlyTerracotta)
            }
            .accessibilityLabel("Add Baking Task")
        }
    }
}

// MARK: - DateStripCell

struct DateStripCell: View {
    let date: Date
    let isSelected: Bool
    let hasItems: Bool

    var body: some View {
        VStack(spacing: 6) {
            Text(date.shortWeekday)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(isSelected ? Color.white : Color.secondary)
            Text(date.dayNumber)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(isSelected ? Color.white : (Calendar.current.isDateInToday(date) ? Color.bakerlyTerracotta : Color.primary))
            Circle()
                .fill(hasItems ? (isSelected ? .white : Color.bakerlyOrange) : Color.clear)
                .frame(width: 5, height: 5)
        }
        .frame(width: 44, height: 68)
        .background(
            Group {
                if isSelected {
                    Color.bakerlyTerracotta
                } else if Calendar.current.isDateInToday(date) {
                    Color.bakerlyTerracotta.opacity(0.12)
                } else {
                    Color(.secondarySystemBackground)
                }
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - ScheduleOrderRow

struct ScheduleOrderRow: View {
    let order: Order
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 4)
                .fill(order.status.statusColor)
                .frame(width: 4, height: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(order.customerName)
                    .font(BakerlyFont.subheading(15))
                Text(order.itemSummary)
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                    .lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text(order.dueDate.relativeWithTime.components(separatedBy: "at").last?.trimmingCharacters(in: .whitespaces) ?? "")
                    .font(BakerlyFont.caption(12))
                    .foregroundStyle(Color.secondary)
                StatusPill(status: order.status)
            }
        }
        .padding(12)
        .bakerlyCard(cornerRadius: 12)
    }
}

// MARK: - ScheduleTaskRow

struct ScheduleTaskRow: View {
    let task: BakingTask
    var onTap: () -> Void
    var onComplete: () -> Void
    var onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                onComplete()
            }) {
                Image(systemName: task.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(task.isCompleted ? Color.bakerlyBlue : Color.bakerlyGray3)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.displayTitle)
                    .font(BakerlyFont.subheading(15))
                    .strikethrough(task.isCompleted)
                Label(task.dueDate.relativeWithTime, systemImage: "clock")
                    .font(BakerlyFont.caption(12))
                    .foregroundStyle(task.isOverdue ? Color.bakerlyRed : Color.secondary)
            }

            Spacer()

            if let recipe = task.recipe {
                Image(systemName: "book.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.bakerlyGold)
            }
        }
        .padding(12)
        .bakerlyCard(cornerRadius: 12)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) { onDelete() } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}

// MARK: - TaskDetailSheet

struct TaskDetailSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Bindable var task: BakingTask
    @State private var showingEdit = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    Text(task.title).font(BakerlyFont.subheading())
                    Label(task.dueDate.relativeWithTime, systemImage: "clock")
                        .foregroundStyle(task.isOverdue ? Color.bakerlyRed : Color.secondary)
                }
                if let recipe = task.recipe {
                    Section("Linked Recipe") {
                        Text(recipe.name)
                    }
                }
                if let order = task.order {
                    Section("Linked Order") {
                        Text(order.customerName)
                    }
                }
                if !task.notes.isEmpty {
                    Section("Notes") {
                        Text(task.notes)
                    }
                }
                Section {
                    Toggle("Completed", isOn: $task.isCompleted)
                        .tint(Color.bakerlyBlue)
                        .onChange(of: task.isCompleted) { _, _ in
                            try? modelContext.save()
                        }
                }
            }
            .navigationTitle("Task Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { showingEdit = true }
                        .foregroundStyle(Color.bakerlyTerracotta)
                }
            }
            .sheet(isPresented: $showingEdit) {
                AddBakingTaskView(existingTask: task)
            }
        }
    }
}

//
//  TicketDetailView.swift
//  Bakeri Admin
//
//  Module 4 — Support Ticket Detail.
//  Full ticket body, internal notes log, status & assignment controls.
//

import SwiftUI

struct TicketDetailView: View {
    let ticket: FeedbackTicket
    let onUpdated: (FeedbackTicket) -> Void

    @State private var newNote = ""
    @State private var notes: [LocalNote] = []
    @State private var assignedTo: String = ""
    @State private var selectedStatus: TicketStatus
    @State private var isUpdating = false
    @State private var showFeedback = false
    @State private var feedbackMsg = ""
    @State private var showCloseConfirm = false
    @State private var closeReason = ""

    init(ticket: FeedbackTicket, onUpdated: @escaping (FeedbackTicket) -> Void) {
        self.ticket = ticket
        self.onUpdated = onUpdated
        _selectedStatus = State(initialValue: ticket.ticketStatus)
        _assignedTo = State(initialValue: ticket.assigned_to ?? "")
    }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            HStack(alignment: .top, spacing: 0) {
                // Main content — ticket body + notes
                mainContent

                Divider()

                // Right panel — controls
                controlPanel.frame(width: 280)
            }

            // Feedback toast
            if showFeedback {
                VStack {
                    Spacer()
                    Text(feedbackMsg).font(.system(size: 13, weight: .medium)).foregroundStyle(.white)
                        .padding(.horizontal, 18).padding(.vertical, 10)
                        .background(DS.success.opacity(0.95)).clipShape(Capsule())
                        .padding(.bottom, 24)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.3), value: showFeedback)
        .sheet(isPresented: $showCloseConfirm) {
            ConfirmDestructiveSheet(
                title: "Close Ticket",
                message: "Marking this ticket as resolved will move it out of the active queue.",
                confirmLabel: "Mark Resolved",
                requiresReason: false,
                reason: $closeReason
            ) {
                Task { await updateStatus(.resolved) }
            }
        }
    }

    // MARK: - Main content

    private var mainContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ticketHeader
                Divider()
                ticketBody
                Divider()
                notesSection
            }
            .padding(28)
        }
    }

    // MARK: - Ticket header

    private var ticketHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(ticket.ticketCategory.color.opacity(0.10))
                        .frame(width: 44, height: 44)
                    Image(systemName: ticket.ticketCategory.icon)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(ticket.ticketCategory.color)
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(ticket.ticketCategory.label)
                            .font(.system(size: 18, weight: .bold)).foregroundStyle(DS.textPrimary)
                        UrgencyBadge(urgency: ticket.urgency)
                        TicketStatusBadge(status: ticket.ticketStatus)
                    }
                    HStack(spacing: 14) {
                        metaDot(icon: "person.fill", text: ticket.displayUserName)
                        metaDot(icon: "envelope.fill", text: ticket.user_email ?? "—")
                        metaDot(icon: "clock.fill", text: relTime(ticket.created_at))
                        if let v = ticket.app_version { metaDot(icon: "apps.iphone", text: "v\(v)") }
                        if let os = ticket.os_version  { metaDot(icon: "iphone",    text: os) }
                    }
                }
            }
            Text("Ticket #\(ticket.id.uuidString.prefix(8).uppercased())")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(DS.textTertiary)
        }
    }

    private func metaDot(icon: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
            Text(text).font(.system(size: 12)).foregroundStyle(DS.textSecondary)
        }
    }

    // MARK: - Ticket body

    private var ticketBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "User Message")
            Text(ticket.message)
                .font(.system(size: 14))
                .foregroundStyle(DS.textPrimary)
                .lineSpacing(4)
                .textSelection(.enabled)
                .padding(16)
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
        }
    }

    // MARK: - Notes section

    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionLabel(text: "Internal Notes (\(notes.count))")

            // Existing notes
            if notes.isEmpty {
                Text("No notes yet. Add context, next steps, or findings below.")
                    .font(.system(size: 13)).foregroundStyle(DS.textTertiary)
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 8) {
                    ForEach(notes) { note in
                        noteCard(note)
                    }
                }
            }

            // Add note
            VStack(alignment: .leading, spacing: 8) {
                Text("Add Note").font(.system(size: 12, weight: .medium)).foregroundStyle(DS.textSecondary)
                TextEditor(text: $newNote)
                    .font(.system(size: 13))
                    .frame(height: 80)
                    .padding(10)
                    .background(DS.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
                    .scrollContentBackground(.hidden)

                HStack {
                    Spacer()
                    Button {
                        guard !newNote.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                        let note = LocalNote(id: UUID(), agent: "Administrator", body: newNote, createdAt: Date())
                        withAnimation { notes.insert(note, at: 0) }
                        newNote = ""
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "plus.circle.fill").font(.system(size: 12, weight: .medium))
                            Text("Add Note").font(.system(size: 13, weight: .medium))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16).padding(.vertical, 9)
                        .background(DS.brand)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                    }
                    .buttonStyle(.plain)
                    .disabled(newNote.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func noteCard(_ note: LocalNote) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                HStack(spacing: 6) {
                    InitialsAvatar(name: note.agent, size: 20, cornerRadius: 5)
                    Text(note.agent).font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textPrimary)
                }
                Spacer()
                Text(relTimeDate(note.createdAt)).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
            }
            Text(note.body).font(.system(size: 13)).foregroundStyle(DS.textPrimary).textSelection(.enabled)
        }
        .padding(14)
        .background(DS.gold.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.gold.opacity(0.2), lineWidth: 1))
    }

    // MARK: - Control panel

    private var controlPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                controlSection("Status") {
                    VStack(spacing: 6) {
                        ForEach([TicketStatus.open, .inProgress, .escalated, .resolved, .archived], id: \.rawValue) { status in
                            statusOption(status)
                        }
                    }
                }

                Divider().padding(.vertical, 12)

                controlSection("Assignment") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "person.fill").font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                            TextField("Assign to…", text: $assignedTo)
                                .font(.system(size: 13)).textFieldStyle(.plain)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 8)
                        .background(DS.cardBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
                    }
                }

                Divider().padding(.vertical, 12)

                controlSection("Actions") {
                    VStack(spacing: 8) {
                        actionButton(
                            icon: "checkmark.circle.fill",
                            label: "Save Changes",
                            color: DS.brand
                        ) { Task { await saveChanges() } }

                        actionButton(
                            icon: "checkmark.seal.fill",
                            label: "Mark Resolved",
                            color: DS.success
                        ) { showCloseConfirm = true }

                        actionButton(
                            icon: "archivebox.fill",
                            label: "Archive",
                            color: DS.textSecondary
                        ) { Task { await updateStatus(.archived) } }
                    }
                }

                Divider().padding(.vertical, 12)

                controlSection("Ticket Info") {
                    VStack(spacing: 0) {
                        infoRow("ID", value: "#\(ticket.id.uuidString.prefix(8).uppercased())")
                        Divider().padding(.leading, 12)
                        infoRow("Category", value: ticket.ticketCategory.label)
                        Divider().padding(.leading, 12)
                        infoRow("Urgency", value: ticket.urgency.label)
                        Divider().padding(.leading, 12)
                        infoRow("Opened", value: fmtDate(ticket.created_at))
                        if let a = ticket.assigned_to {
                            Divider().padding(.leading, 12)
                            infoRow("Assigned", value: a)
                        }
                    }
                    .background(DS.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder))
                }
            }
            .padding(20)
        }
        .background(DS.cardBg)
    }

    private func statusOption(_ status: TicketStatus) -> some View {
        let isSelected = selectedStatus == status
        return Button { selectedStatus = status } label: {
            HStack(spacing: 8) {
                Circle().fill(status.color).frame(width: 8, height: 8)
                Text(status.label)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(isSelected ? status.color : DS.textSecondary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(status.color)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(isSelected ? status.color.opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func actionButton(icon: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13, weight: .medium))
                Text(label).font(.system(size: 13, weight: .medium))
                Spacer()
                if isUpdating { ProgressView().scaleEffect(0.6).frame(width: 16, height: 16) }
            }
            .foregroundStyle(color)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(color.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(color.opacity(0.25)))
        }
        .buttonStyle(.plain)
        .disabled(isUpdating)
    }

    @ViewBuilder
    private func controlSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .bold)).tracking(0.8).foregroundStyle(DS.textTertiary)
            content()
        }
    }

    private func infoRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
            Spacer()
            Text(value).font(.system(size: 11, weight: .medium)).foregroundStyle(DS.textPrimary)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    // MARK: - Actions

    private func saveChanges() async {
        isUpdating = true
        var updated = ticket
        updated.admin_status = selectedStatus.rawValue
        updated.assigned_to  = assignedTo.isEmpty ? nil : assignedTo
        do {
            try await SupabaseAdminService.shared.updateTicketStatus(
                id: ticket.id, status: selectedStatus.rawValue,
                assignedTo: assignedTo.isEmpty ? nil : assignedTo
            )
            onUpdated(updated)
            toast("Changes saved.")
        } catch {
            toast("Save failed: \(error.localizedDescription)")
        }
        isUpdating = false
    }

    private func updateStatus(_ status: TicketStatus) async {
        selectedStatus = status
        await saveChanges()
    }

    private func toast(_ msg: String) {
        feedbackMsg = msg
        withAnimation { showFeedback = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { withAnimation { showFeedback = false } }
    }

    // MARK: - Helpers

    private func relTime(_ iso: String) -> String {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = df.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) ?? Date()
        let diff = Date().timeIntervalSince(d)
        if diff < 3600  { return "\(Int(diff/60))m ago" }
        if diff < 86400 { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }

    private func relTimeDate(_ d: Date) -> String {
        let diff = Date().timeIntervalSince(d)
        if diff < 3600  { return "\(Int(diff/60))m ago" }
        if diff < 86400 { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }

    private func fmtDate(_ iso: String) -> String {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = df.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) ?? Date()
        let f = DateFormatter(); f.dateFormat = "MMM d, yyyy"
        return f.string(from: d)
    }

    // MARK: - Local note model

    struct LocalNote: Identifiable {
        let id: UUID
        let agent: String
        let body: String
        let createdAt: Date
    }
}

// TicketCategory color extension accessed from this file
private extension TicketCategory {
    var color: Color {
        switch self {
        case .payment:     return DS.success
        case .fulfillment: return DS.gold
        case .technical:   return DS.info
        case .account:     return DS.brand
        case .listing:     return Color.purple
        case .refund:      return DS.danger
        case .other:       return DS.textSecondary
        }
    }
}

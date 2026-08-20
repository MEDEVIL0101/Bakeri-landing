//
//  Config.swift
//  Bakeri Admin
//
//  Reads from Secrets.swift (gitignored). Copy Secrets.swift.template → Secrets.swift
//  and fill in your Supabase project credentials.
//

import Foundation

enum SupabaseConfig {
    static let projectURL    = BakeriAdminSecrets.supabaseURL
    static let serviceRoleKey = BakeriAdminSecrets.serviceRoleKey

    static let takeRatePct: Double = 0.05  // 5% platform commission on marketplace GTV
}

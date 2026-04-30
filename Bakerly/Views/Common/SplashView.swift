import SwiftUI

// MARK: - SplashView
// Displays on app launch while SwiftData bootstraps.

struct SplashView: View {
    @State private var logoScale: CGFloat    = 0.6
    @State private var logoOpacity: Double   = 0
    @State private var titleOffset: CGFloat  = 20
    @State private var titleOpacity: Double  = 0
    @State private var taglineOpacity: Double = 0

    var body: some View {
        ZStack {
            // Background gradient using brand colors
            LinearGradient(
                colors: [Color.bakerlyBeige, Color(hex: "#F8EAD8")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            // Decorative background circles
            Circle()
                .fill(Color.bakerlyTerracotta.opacity(0.06))
                .frame(width: 320, height: 320)
                .offset(x: -80, y: -200)

            Circle()
                .fill(Color.bakerlyOrange.opacity(0.05))
                .frame(width: 240, height: 240)
                .offset(x: 120, y: 280)

            VStack(spacing: 0) {
                Spacer()

                // Logo / icon
                ZStack {
                    Circle()
                        .fill(Color.bakerlyTerracotta.opacity(0.12))
                        .frame(width: 130, height: 130)

                    // If app icon exists as asset, use it; otherwise SF Symbol
                    Image(systemName: "birthday.cake.fill")
                        .font(.system(size: 62, weight: .light))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color.bakerlyTerracotta, Color.bakerlyOrange],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
                .scaleEffect(logoScale)
                .opacity(logoOpacity)
                .padding(.bottom, 28)

                // App name
                Text("Bakerly")
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .foregroundStyle(Color.bakerlyDeepBrown)
                    .offset(y: titleOffset)
                    .opacity(titleOpacity)

                // Tagline
                Text("Your bakery, beautifully organized")
                    .font(.system(size: 16, weight: .regular, design: .rounded))
                    .foregroundStyle(Color.bakerlyWarmBrown)
                    .opacity(taglineOpacity)
                    .padding(.top, 8)

                Spacer()

                // Loading indicator
                VStack(spacing: 10) {
                    ProgressView()
                        .tint(Color.bakerlyTerracotta)
                        .scaleEffect(1.1)
                        .opacity(taglineOpacity)
                    Text("Getting things ready…")
                        .font(.system(size: 13, weight: .regular, design: .rounded))
                        .foregroundStyle(Color.bakerlyWarmBrown.opacity(0.7))
                        .opacity(taglineOpacity)
                }
                .padding(.bottom, 48)
            }
        }
        .onAppear { startAnimations() }
    }

    private func startAnimations() {
        withAnimation(.spring(response: 0.7, dampingFraction: 0.65).delay(0.1)) {
            logoScale   = 1.0
            logoOpacity = 1.0
        }
        withAnimation(.easeOut(duration: 0.5).delay(0.4)) {
            titleOffset  = 0
            titleOpacity = 1.0
        }
        withAnimation(.easeOut(duration: 0.5).delay(0.65)) {
            taglineOpacity = 1.0
        }
    }
}

#Preview {
    SplashView()
}

import ByteSizeKit
import SwiftUI

/// Server address → username + password. Account setup happens in the web app.
struct SignInView: View {
    @Bindable var model: SignInModel
    @Environment(\.palette) private var palette
    @FocusState private var focus: Field?

    private enum Field { case server, username, password }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                header
                if let notice = model.notice {
                    Label(notice, systemImage: "info.circle")
                        .font(.subheadline)
                        .foregroundStyle(palette.color("ink"))
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(palette.color("brand-subtle"), in: RoundedRectangle(cornerRadius: 12))
                }
                card {
                    switch model.step {
                    case .server: serverStep
                    case .credentials: credentialsStep
                    }
                    if let error = model.error {
                        Text(error)
                            .font(.subheadline)
                            .foregroundStyle(palette.color("error"))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("signInError")
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .background(palette.color("page").ignoresSafeArea())
        .task { await model.load() }
        .sheet(isPresented: Binding(get: { model.resetStep != nil }, set: { if !$0 { model.cancelReset() } })) {
            ForgotPasswordView(model: model)
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image("Logo")
                .resizable()
                .interpolation(.none)
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 22))
                .accessibilityHidden(true)
            Text("ByteSize")
                .font(.largeTitle.bold())
                .foregroundStyle(palette.color("ink"))
            Text("Sign in to your ByteSize server")
                .font(.subheadline)
                .foregroundStyle(palette.color("subtle"))
        }
        .padding(.top, 32)
    }

    private var serverStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            field("Server address") {
                TextField("bytesize.example.com", text: $model.serverText)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .server)
                    .submitLabel(.continue)
                    .onSubmit { Task { await model.connect() } }
                    .accessibilityIdentifier("serverField")
            }
            primaryButton("Continue", enabled: model.canContinue) { await model.connect() }
        }
        .onAppear { focus = .server }
    }

    private var credentialsStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Server: \(model.address?.host ?? "")")
                    .font(.footnote)
                    .foregroundStyle(palette.color("subtle"))
                    .lineLimit(1)
                Text("·").foregroundStyle(palette.color("muted"))
                Button("Change") { model.changeServer() }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(palette.color("link"))
            }
            if model.showsPasswordForm {
                field("Username") {
                    TextField("Username", text: $model.username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .username)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .accessibilityIdentifier("usernameField")
                }
                field("Password") {
                    SecureField("Password", text: $model.password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await model.signIn() } }
                        .accessibilityIdentifier("passwordField")
                }
                primaryButton("Sign in", enabled: model.canSignIn) { await model.signIn() }
                if model.showsForgotPassword {
                    Button("Forgot password?") { model.startReset() }
                        .font(.subheadline)
                        .foregroundStyle(palette.color("link"))
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .onAppear { focus = model.username.isEmpty ? .username : .password }
    }

    // MARK: - pieces

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16, content: content)
            .padding(20)
            .background(palette.color("container"), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(palette.color("line")))
    }

    private func field<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(palette.color("subtle"))
            content()
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .foregroundStyle(palette.color("ink"))
                .background(palette.color("page"), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.color("strong")))
        }
    }

    private func primaryButton(_ title: String, enabled: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack {
                if model.busy { ProgressView().tint(palette.color("on-primary")) }
                Text(title).fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(palette.color("on-primary"))
            .background(palette.color("primary").opacity(enabled ? 1 : 0.45), in: RoundedRectangle(cornerRadius: 12))
        }
        .disabled(!enabled)
    }
}

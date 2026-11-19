import ByteSizeKit
import SwiftUI

/// Email → 6-digit code + new password. A good code signs you straight in.
struct ForgotPasswordView: View {
    @Bindable var model: SignInModel
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            Form {
                if model.resetStep == .email {
                    Section {
                        TextField("Email", text: $model.resetEmail)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } footer: {
                        Text("We'll email a 6-digit code to the address on your account.")
                    }
                    Section {
                        Button("Send code") { Task { await model.sendCode() } }
                            .disabled(model.resetEmail.trimmingCharacters(in: .whitespaces).isEmpty || model.busy)
                    }
                } else {
                    if let notice = model.resetNotice {
                        Section { Text(notice).foregroundStyle(palette.color("subtle")) }
                    }
                    Section {
                        TextField("6-digit code", text: $model.resetCode)
                            .textContentType(.oneTimeCode)
                            .keyboardType(.numberPad)
                        SecureField("New password", text: $model.newPassword)
                            .textContentType(.newPassword)
                    }
                    Section {
                        Button("Set password and sign in") { Task { await model.resetPassword() } }
                            .disabled(model.resetCode.isEmpty || model.newPassword.isEmpty || model.busy)
                    }
                }
                if let error = model.resetError {
                    Section { Text(error).foregroundStyle(palette.color("error")) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(palette.color("page"))
            .navigationTitle("Reset password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.cancelReset() } }
            }
        }
    }
}

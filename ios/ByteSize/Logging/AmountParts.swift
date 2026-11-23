import ByteSizeKit
import SwiftUI

/// "Serving   2½ tbsp ›": the amount in words; tapping it opens the wheel underneath (and closes it again).
struct ServingRow: View {
    @Bindable var portion: PortionModel
    @Binding var open: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        Button {
            withAnimation(.snappy) { open.toggle() }
        } label: {
            HStack {
                Text("Serving").foregroundStyle(palette.color("ink"))
                Spacer()
                Text(portion.amountText)
                    .fontWeight(.semibold)
                    .foregroundStyle(palette.color("ink"))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(palette.color("subtle"))
                    .rotationEffect(.degrees(open ? 90 : 0))
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Serving")
        .accessibilityValue(portion.amountText)
        .accessibilityHint(open ? "Closes the amount wheel" : "Opens the amount wheel")
        .accessibilityIdentifier("servingRow")
        if open {
            AmountWheel(portion: portion)
        }
    }
}

/// Every nutrient the food has, for the amount chosen (it follows the wheel).
struct NutritionSection: View {
    let portion: PortionModel
    @Environment(\.palette) private var palette

    var body: some View {
        Section {
            ForEach(portion.facts, id: \.key) { fact in
                HStack {
                    Text(fact.label)
                        .fontWeight(fact.key == "calories" ? .semibold : .regular)
                    Spacer()
                    Text(Self.text(fact))
                        .monospacedDigit()
                        .foregroundStyle(palette.color(fact.key == "calories" ? "ink" : "subtle"))
                        .contentTransition(.numericText())
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(fact.label) \(Self.text(fact))")
                .accessibilityIdentifier("fact-\(fact.key)")
            }
        } header: {
            Text("Nutrition")
        } footer: {
            Text("For \(portion.amountText).")
        }
    }

    /// 105 → "105", 3.33 → "3.3 g", 0.04 → "0 g"
    static func text(_ f: PortionModel.Fact) -> String {
        let shown = f.key == "calories" || f.unit == "mg" ? String(Int(f.value.rounded())) : {
            let one = (f.value * 10).rounded() / 10
            return one.rounded() == one ? String(Int(one)) : String(one)
        }()
        return f.unit.isEmpty ? shown : "\(shown) \(f.unit)"
    }
}

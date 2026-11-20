import ByteSizeKit
import SwiftUI

/// L1 (SPEC-09): the amount as three wheels — whole number | fraction | unit — as in Cory's reference. Calories follow
/// as the wheels turn (the portion's preview).
struct AmountWheel: View {
    @Bindable var portion: PortionModel

    var body: some View {
        HStack(spacing: 0) {
            Picker("Whole number", selection: $portion.whole) {
                ForEach(portion.wholeRange, id: \.self) { Text("\($0)").tag($0) }
            }
            .accessibilityIdentifier("wheelWhole")
            Picker("Fraction", selection: $portion.fraction) {
                ForEach(AmountMath.fractions, id: \.value) { Text($0.label).tag($0.value) }
            }
            .accessibilityIdentifier("wheelFraction")
            Picker("Unit", selection: $portion.choice) {
                ForEach(portion.choices, id: \.choice) { Text($0.label).tag($0.choice) }
            }
            .frame(minWidth: 130)
            .accessibilityIdentifier("wheelUnit")
        }
        .pickerStyle(.wheel)
        .frame(height: 170)
        // The number stays when the unit changes (3 cups → 3 tbsp); a whole number off the new wheel snaps to it
        .onChange(of: portion.choice) {
            if !portion.wholeRange.contains(portion.whole) { portion.whole = portion.wholeRange.last(where: { $0 <= portion.whole }) ?? 1 }
        }
    }
}

/// "That's a lot — log 2,100 cal of Banana?" (more than 20 servings or 2,000 calories).
enum BigAmount {
    static func question(calories: Int, name: String) -> String {
        let n = NumberFormatter()
        n.numberStyle = .decimal
        return "That's a lot — log \(n.string(from: NSNumber(value: calories)) ?? "\(calories)") cal of \(name)?"
    }
}

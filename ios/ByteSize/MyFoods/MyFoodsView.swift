import ByteSizeKit
import SwiftUI

/// The My Foods tab: the person's own foods, corrections, recipes and quick meals. Tap a food to pick an amount and
/// log it to the day being looked at; tap a quick meal to choose which of its items to log.
struct MyFoodsView: View {
    @Bindable var model: MyFoodsModel
    @Environment(\.palette) private var palette
    /// The food waiting for "Delete <name>?".
    @State private var deleting: Food?
    /// The editor open (New or Edit); buttons, since a NavigationLink in a menu or swipe action doesn't push.
    @State private var editing: MyFoodsRoute?

    var body: some View {
        List {
            Section {
                // Not .searchable: on iOS 26 its bar sits at the bottom, under the app's own tab bar
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(palette.color("subtle"))
                    TextField("Search my foods", text: $model.query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .accessibilityIdentifier("myFoodsSearch")
                    if !model.query.isEmpty {
                        Button { model.query = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain)
                            .foregroundStyle(palette.color("subtle"))
                            .accessibilityLabel("Clear search")
                    }
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(MyFoodsModel.Filter.allCases, id: \.self) { f in
                            Button(f.title) {
                                model.filter = f
                                Task { await model.load() }
                            }
                            .buttonStyle(.bordered)
                            .tint(model.filter == f ? palette.color("primary") : palette.color("subtle"))
                            .accessibilityIdentifier("filter-\(f.id)")
                            .accessibilityAddTraits(model.filter == f ? .isSelected : [])
                        }
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            }
            Section {
                if let empty = model.emptyText {
                    Text(empty).foregroundStyle(palette.color("subtle"))
                }
                ForEach(model.foods) { food in
                    NavigationLink(value: food) { row(food) }
                        .accessibilityIdentifier("myFood-\(food.id)")
                        // R2: tapping still logs; swipe for Delete
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { deleting = food } label: { Label("Delete", systemImage: "trash") }
                            Button { editing = .edit(food) } label: { Label("Edit", systemImage: "pencil") }
                                .tint(palette.color("primary"))
                        }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(palette.color("page"))
        .onChange(of: model.query) { Task { await model.queryChanged() } }
        .refreshable { await model.load() }
        .task { if !model.loaded { await model.load() } }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                // R2: New food / New recipe / New quick meal, as the website's buttons
                Menu {
                    Button("New food") { editing = .food(nil) }
                    Button("New recipe") { editing = .recipe(nil) }
                    Button("New quick meal") { editing = .meal(nil) }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New")
                .accessibilityIdentifier("newMenu")
            }
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Picker("Sort", selection: $model.sort) {
                        ForEach(MyFoodsModel.Sort.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .accessibilityLabel("Sort")
                .accessibilityIdentifier("sortMenu")
            }
        }
        .onChange(of: model.sort) { Task { await model.load() } }
        .navigationDestination(item: $editing) { route in
            let saved = { Task { await model.saved() } }
            switch route {
            case .food(let food): FoodEditorView(model: model.foodEditor(food)) { _ = saved() }
            case .recipe(let id): RecipeEditorView(model: model.recipeEditor(id: id), picker: model.picker) { _ = saved() }
            case .meal(let id): QuickMealEditorView(model: model.mealEditor(id: id), picker: model.picker) { _ = saved() }
            }
        }
        .navigationDestination(for: Food.self) { food in
            if food.foodKind == "quick_meal" {
                QuickMealView(model: model.quickMeal(food))
            } else {
                FoodPortionView(food: food, meal: model.meal, pushed: true, message: model.message) { food, portion in
                    await model.log(food, portion: portion)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let message = model.message {
                MessageBanner(text: message) {}.padding(.bottom, 8)
            } else if let notice = model.notice {
                NoticeBanner(text: notice) { model.clearNotice() }.padding(.bottom, 8)
            }
        }
        // The website's wording (MyFoodsPage)
        .confirmationDialog(deleting.map { "Delete \($0.name)?" } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting) { food in
            Button("Delete", role: .destructive) { Task { await model.delete(food) } }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("If it's been logged or is part of a recipe or meal, it's hidden instead, so your log stays as it is.")
        }
    }

    private func row(_ food: Food) -> some View {
        HStack(spacing: 12) {
            Text(food.icon).font(.title2)
            VStack(alignment: .leading, spacing: 2) {
                Text(food.name).foregroundStyle(palette.color("ink"))
                Text(detail(food)).font(.caption).foregroundStyle(palette.color("subtle"))
            }
        }
    }

    private func detail(_ food: Food) -> String {
        let kind = switch food.foodKind {
        case "override": "My edit"
        case "recipe": "Recipe"
        case "quick_meal": "Quick meal"
        default: "Food"
        }
        let serving = food.servings.first?.label ?? "serving"
        return "\(kind) · \(Int(food.calories.rounded())) cal per \(serving)"
    }
}

extension MyFoodsModel.Filter: Identifiable {
    public var id: String {
        switch self {
        case .all: "all"
        case .foods: "foods"
        case .edits: "edits"
        case .recipes: "recipes"
        case .meals: "meals"
        }
    }
}

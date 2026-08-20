import 'dart:io';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3_flutter_libs/sqlite3_flutter_libs.dart';
import 'package:sqlite3/sqlite3.dart';

import 'tables.dart';

part 'database.g.dart';

@DriftDatabase(tables: [
  Recipes,
  RecipeIngredients,
  MenuItems,
  MenuItemRecipes,
  BoxSizeTiers,
  BoxVariants,
  Orders,
  OrderReferencePhotos,
  OrderReferenceDocuments,
  OrderItems,
  BakingTasks,
  BakingTaskOrders,
  BakingTaskRecipes,
  IngredientCosts,
  IngredientDensities,
])
class BakeriDatabase extends _$BakeriDatabase {
  BakeriDatabase() : super(_openConnection());
  BakeriDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (Migrator m) async {
          await m.createAll();
        },
        // Schema changes here are additive-friendly (Drift generates
        // migration steps automatically via `driftGenerateSteps`, wired up
        // once the schema actually needs to change). The iOS app wipes the
        // local store on any SwiftData schema change (see
        // BakeriApp.modelContainer's error handling) — matching that
        // "blow it away" fallback for the Flutter build isn't done here,
        // deliberately: SQLite migrations are cheap enough to do properly.
      );
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dbFolder = await getApplicationDocumentsDirectory();
    final file = File(p.join(dbFolder.path, 'bakeri.sqlite'));
    if (Platform.isIOS || Platform.isAndroid) {
      await applyWorkaroundToOpenSqlite3OnOldAndroidVersions();
    }
    final cachebase = (await getTemporaryDirectory()).path;
    sqlite3.tempDirectory = cachebase;
    return NativeDatabase.createInBackground(file);
  });
}

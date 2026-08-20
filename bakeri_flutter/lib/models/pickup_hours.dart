// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/PickupHours.swift.
//
// Structured weekly pickup hours. Encoded to/from JSON for both local
// storage and the server (profiles.pickup_hours_json), so the same shape is
// shared with the storefront's theme.js consumer.
import 'dart:convert';

class PickupDayHours {
  bool closed;
  String open; // 24h "HH:mm"
  String close;

  PickupDayHours({this.closed = true, this.open = '09:00', this.close = '17:00'});

  Map<String, dynamic> toJson() => {'closed': closed, 'open': open, 'close': close};

  /// Tolerates a partial object (missing closed/open/close) the same way
  /// PickupWeekHours.fromJson tolerates a missing day — see there for why
  /// this can't just throw on an incomplete shape.
  factory PickupDayHours.fromJson(Map<String, dynamic>? json) {
    if (json == null) return PickupDayHours();
    return PickupDayHours(
      closed: json['closed'] as bool? ?? true,
      open: json['open'] as String? ?? '09:00',
      close: json['close'] as String? ?? '17:00',
    );
  }
}

class PickupWeekHours {
  PickupDayHours mon;
  PickupDayHours tue;
  PickupDayHours wed;
  PickupDayHours thu;
  PickupDayHours fri;
  PickupDayHours sat;
  PickupDayHours sun;

  PickupWeekHours({
    PickupDayHours? mon,
    PickupDayHours? tue,
    PickupDayHours? wed,
    PickupDayHours? thu,
    PickupDayHours? fri,
    PickupDayHours? sat,
    PickupDayHours? sun,
  })  : mon = mon ?? PickupDayHours(),
        tue = tue ?? PickupDayHours(),
        wed = wed ?? PickupDayHours(),
        thu = thu ?? PickupDayHours(),
        fri = fri ?? PickupDayHours(),
        sat = sat ?? PickupDayHours(),
        sun = sun ?? PickupDayHours();

  /// In display order, Monday first — pairs each day with a short label.
  List<(String, PickupDayHours)> get orderedDays => [
        ('Mon', mon),
        ('Tue', tue),
        ('Wed', wed),
        ('Thu', thu),
        ('Fri', fri),
        ('Sat', sat),
        ('Sun', sun),
      ];

  Map<String, dynamic> toJson() => {
        'mon': mon.toJson(),
        'tue': tue.toJson(),
        'wed': wed.toJson(),
        'thu': thu.toJson(),
        'fri': fri.toJson(),
        'sat': sat.toJson(),
        'sun': sun.toJson(),
      };

  String get jsonString => jsonEncode(toJson());

  // profiles.pickup_hours_json is NOT NULL DEFAULT '{}'::jsonb — every
  // profile starts with a genuinely empty object until a baker saves hours
  // through the Pickup & Hours editor, not a full 7-day object. A naive
  // strict decode that requires every weekday key to be present broke
  // get_my_profile()'s response for any account that hadn't set hours yet
  // (confirmed live 2026-08-03: "The data couldn't be read because it is
  // missing" on every brand-new signup). A missing day means "closed",
  // exactly like PickupDayHours' own defaults — decode that way instead of
  // failing the whole profile fetch.
  factory PickupWeekHours.decode(String jsonString) {
    if (jsonString.isEmpty) return PickupWeekHours();
    try {
      final json = jsonDecode(jsonString) as Map<String, dynamic>;
      return PickupWeekHours(
        mon: PickupDayHours.fromJson(json['mon'] as Map<String, dynamic>?),
        tue: PickupDayHours.fromJson(json['tue'] as Map<String, dynamic>?),
        wed: PickupDayHours.fromJson(json['wed'] as Map<String, dynamic>?),
        thu: PickupDayHours.fromJson(json['thu'] as Map<String, dynamic>?),
        fri: PickupDayHours.fromJson(json['fri'] as Map<String, dynamic>?),
        sat: PickupDayHours.fromJson(json['sat'] as Map<String, dynamic>?),
        sun: PickupDayHours.fromJson(json['sun'] as Map<String, dynamic>?),
      );
    } catch (_) {
      return PickupWeekHours();
    }
  }
}

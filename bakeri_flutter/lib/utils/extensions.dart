// Ported 1:1 from Bakerly/Bakerly/Bakeri/Utils/Extensions.swift
// (Double/Date/String extensions only — the UIImage/View/Color/Binding
// extensions are UIKit/SwiftUI-specific plumbing with no Dart equivalent to
// port; their call sites get re-derived using Flutter idioms when the
// screens that use them are ported).
import 'package:intl/intl.dart';

extension BakeriDoubleFormatting on double {
  /// Formats as currency using the device locale.
  String get asCurrency {
    final formatter = NumberFormat.currency(locale: Intl.defaultLocale, decimalDigits: 2);
    return formatter.format(this);
  }

  /// Formats as a clean decimal removing unnecessary trailing zeros
  /// (source uses "%.2g" — 2 significant digits; matched below).
  String get cleanString {
    if (this % 1 == 0) return toInt().toString();
    return toStringAsPrecision(2);
  }

  /// Formats with up to 2 decimal places, stripping trailing zeros.
  String get shortString {
    if (this == 0) return '0';
    if (this % 1 == 0) return toInt().toString();
    var s = toStringAsFixed(2);
    if (s.endsWith('0')) s = s.substring(0, s.length - 1);
    return s;
  }

  double roundedTo(int places) {
    final multiplier = pow10(places);
    return (this * multiplier).round() / multiplier;
  }

  bool get isWhole => this % 1 == 0;
}

double pow10(int places) {
  var result = 1.0;
  for (var i = 0; i < places; i++) {
    result *= 10;
  }
  return result;
}

extension BakeriDateFormatting on DateTime {
  bool get isToday => _isSameDay(this, DateTime.now());
  bool get isTomorrow => _isSameDay(this, DateTime.now().add(const Duration(days: 1)));
  bool get isYesterday => _isSameDay(this, DateTime.now().subtract(const Duration(days: 1)));
  bool get isPast => isBefore(DateTime.now());

  DateTime get startOfDay => DateTime(year, month, day);
  DateTime get endOfDay => DateTime(year, month, day, 23, 59, 59);

  /// "Today", "Tomorrow", or formatted date.
  String get relativeDisplay {
    if (isToday) return 'Today';
    if (isTomorrow) return 'Tomorrow';
    return DateFormat.yMMMd().format(this);
  }

  /// Short relative: "Today at 3:00 PM", "Mar 15 at 2:00 PM".
  String get relativeWithTime {
    final timeStr = DateFormat.jm().format(this);
    if (isToday) return 'Today at $timeStr';
    if (isTomorrow) return 'Tomorrow at $timeStr';
    return '${DateFormat.MMMd().format(this)} at $timeStr';
  }

  /// Days until this date (negative = past).
  int get daysFromNow => startOfDay.difference(DateTime.now().startOfDay).inDays;

  /// "Mon", "Tue", etc.
  String get shortWeekday => DateFormat.E().format(this);

  /// Day number as String: "14".
  String get dayNumber => DateFormat.d().format(this);

  /// Month name abbreviated: "Jan".
  String get shortMonth => DateFormat.MMM().format(this);

  DateTime get startOfMonth => DateTime(year, month, 1);
  DateTime get endOfMonth => DateTime(year, month + 1, 1).subtract(const Duration(milliseconds: 1));
  DateTime get startOfYear => DateTime(year, 1, 1);
  DateTime get endOfYear => DateTime(year + 1, 1, 1).subtract(const Duration(milliseconds: 1));
}

bool _isSameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

extension BakeriStringHelpers on String {
  String get trimmed => trim();
  bool get isBlank => trimmed.isEmpty;
}

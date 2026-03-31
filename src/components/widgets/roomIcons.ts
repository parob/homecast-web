import {
  Sofa,
  Bed,
  CookingPot,
  UtensilsCrossed,
  Bath,
  ShowerHead,
  Monitor,
  BookOpen,
  WashingMachine,
  Shirt,
  Archive,
  Car,
  TreePine,
  Sunrise,
  Waves,
  Leaf,
  DoorOpen,
  DoorClosed,
  House,
  Baby,
  Dumbbell,
  Droplet,
  User,
  Film,
  Gamepad2,
  Wine,
  Palette,
  PawPrint,
  Server,
  ArrowUpFromLine,
  type LucideIcon,
} from 'lucide-react';

/**
 * Get the appropriate Lucide icon component for a room based on its name.
 * Matches the logic from app-ios-macos/Sources/MenuBarPlugin/PhosphorIcon.swift
 */
export function getRoomIcon(roomName: string): LucideIcon {
  const lowercased = roomName.toLowerCase();

  // Living spaces
  if (lowercased.includes('living') || lowercased.includes('lounge') || lowercased.includes('family') || lowercased.includes('den')) {
    return Sofa;
  }

  // Bedrooms
  if (lowercased.includes('bedroom') || lowercased.includes('bed')) {
    return Bed;
  }

  // Kitchen
  if (lowercased.includes('kitchen') || lowercased.includes('kitchenette')) {
    return CookingPot;
  }

  // Dining
  if (lowercased.includes('dining') || lowercased.includes('breakfast')) {
    return UtensilsCrossed;
  }

  // Bathrooms
  if (lowercased.includes('bath') || lowercased.includes('restroom') || lowercased.includes('toilet') || lowercased.includes('powder')) {
    return Bath;
  }
  if (lowercased.includes('shower')) {
    return ShowerHead;
  }

  // Work spaces
  if (lowercased.includes('office') || lowercased.includes('study') || lowercased.includes('workspace')) {
    return Monitor;
  }
  if (lowercased.includes('library') || lowercased.includes('reading')) {
    return BookOpen;
  }

  // Utility
  if (lowercased.includes('laundry') || lowercased.includes('utility') || lowercased.includes('mud room') || lowercased.includes('mudroom')) {
    return WashingMachine;
  }
  if (lowercased.includes('closet') || lowercased.includes('wardrobe') || lowercased.includes('dressing')) {
    return Shirt;
  }
  if (lowercased.includes('storage') || lowercased.includes('store room')) {
    return Archive;
  }

  // Garage & outdoor
  if (lowercased.includes('garage') || lowercased.includes('carport')) {
    return Car;
  }
  if (lowercased.includes('garden') || lowercased.includes('yard') || lowercased.includes('outdoor') || lowercased.includes('outside')) {
    return TreePine;
  }
  if (lowercased.includes('balcony') || lowercased.includes('patio') || lowercased.includes('terrace') || lowercased.includes('deck') || lowercased.includes('porch')) {
    return Sunrise;
  }
  if (lowercased.includes('pool') || lowercased.includes('swimming')) {
    return Waves;
  }
  if (lowercased.includes('greenhouse') || lowercased.includes('conservatory')) {
    return Leaf;
  }

  // Entries & passages
  if (lowercased.includes('hallway') || lowercased.includes('hall') || lowercased.includes('corridor') || lowercased.includes('passage') || lowercased.includes('landing')) {
    return DoorOpen;
  }
  if (lowercased.includes('entry') || lowercased.includes('foyer') || lowercased.includes('vestibule') || lowercased.includes('entrance') || lowercased.includes('lobby')) {
    return DoorClosed;
  }
  if (lowercased.includes('stairs') || lowercased.includes('stairway') || lowercased.includes('staircase')) {
    return ArrowUpFromLine;
  }

  // Levels
  if (lowercased.includes('basement') || lowercased.includes('cellar') || lowercased.includes('lower level')) {
    return ArrowUpFromLine;
  }
  if (lowercased.includes('attic') || lowercased.includes('loft') || lowercased.includes('upper level')) {
    return House;
  }

  // Kids & wellness
  if (lowercased.includes('nursery') || lowercased.includes('kid') || lowercased.includes('child') || lowercased.includes('playroom')) {
    return Baby;
  }
  if (lowercased.includes('gym') || lowercased.includes('fitness') || lowercased.includes('workout') || lowercased.includes('exercise')) {
    return Dumbbell;
  }
  if (lowercased.includes('spa') || lowercased.includes('sauna') || lowercased.includes('steam')) {
    return Droplet;
  }

  // Guest & misc
  if (lowercased.includes('guest') || lowercased.includes('spare')) {
    return User;
  }
  if (lowercased.includes('theater') || lowercased.includes('theatre') || lowercased.includes('cinema') || lowercased.includes('movie')) {
    return Film;
  }
  if (lowercased.includes('game') || lowercased.includes('gaming') || lowercased.includes('rec room') || lowercased.includes('recreation')) {
    return Gamepad2;
  }
  if (lowercased.includes('wine') || lowercased.includes('cellar')) {
    return Wine;
  }
  if (lowercased.includes('studio') || lowercased.includes('art') || lowercased.includes('craft')) {
    return Palette;
  }
  if (lowercased.includes('pet') || lowercased.includes('dog') || lowercased.includes('cat')) {
    return PawPrint;
  }
  if (lowercased.includes('server') || lowercased.includes('network') || lowercased.includes('tech')) {
    return Server;
  }

  // Default fallback
  return DoorClosed;
}

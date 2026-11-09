/**
 * The glyphs this app uses that cubeui's own set does not carry. Each is wrapped by cubeui's
 * `icon`, so it takes a `className` and inherits a button's icon colour like the vendored ones.
 * `app-icons.web.tsx` is the same list with the sources taken from `lucide-react`.
 *
 * `Link` is exported as `LinkIcon`: expo-router owns the other name.
 */
import ArrowDownSource from "lucide-react-native/icons/arrow-down";
import BookOpenSource from "lucide-react-native/icons/book-open";
import ClipboardSource from "lucide-react-native/icons/clipboard";
import CornerDownLeftSource from "lucide-react-native/icons/corner-down-left";
import CpuSource from "lucide-react-native/icons/cpu";
import GlobeSource from "lucide-react-native/icons/globe";
import LinkSource from "lucide-react-native/icons/link";
import MenuSource from "lucide-react-native/icons/menu";
import MessageSquareSource from "lucide-react-native/icons/message-square";
import MicSource from "lucide-react-native/icons/mic";
import MicOffSource from "lucide-react-native/icons/mic-off";
import PanelLeftSource from "lucide-react-native/icons/panel-left";
import SaveSource from "lucide-react-native/icons/save";
import SendSource from "lucide-react-native/icons/send";
import SlidersHorizontalSource from "lucide-react-native/icons/sliders-horizontal";
import SmartphoneSource from "lucide-react-native/icons/smartphone";
import TerminalSource from "lucide-react-native/icons/terminal";
import Volume2Source from "lucide-react-native/icons/volume-2";
import VolumeXSource from "lucide-react-native/icons/volume-x";
import WrenchSource from "lucide-react-native/icons/wrench";
import { icon } from "@/components/ui/icons";

export const ArrowDown = icon(ArrowDownSource);
export const BookOpen = icon(BookOpenSource);
export const Clipboard = icon(ClipboardSource);
export const CornerDownLeft = icon(CornerDownLeftSource);
export const Cpu = icon(CpuSource);
export const Globe = icon(GlobeSource);
export const LinkIcon = icon(LinkSource);
export const Menu = icon(MenuSource);
export const MessageSquare = icon(MessageSquareSource);
export const Mic = icon(MicSource);
export const MicOff = icon(MicOffSource);
export const PanelLeft = icon(PanelLeftSource);
export const Save = icon(SaveSource);
export const Send = icon(SendSource);
export const SlidersHorizontal = icon(SlidersHorizontalSource);
export const Smartphone = icon(SmartphoneSource);
export const Terminal = icon(TerminalSource);
export const Volume2 = icon(Volume2Source);
export const VolumeX = icon(VolumeXSource);
export const Wrench = icon(WrenchSource);

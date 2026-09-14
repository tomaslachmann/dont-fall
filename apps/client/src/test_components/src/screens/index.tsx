import type { ComponentType } from 'react';
import MainMenu from './MainMenu';
import RaceHUD from './RaceHUD';
import Grabbed from './Grabbed';
import Countdown from './Countdown';
import MatchOver from './MatchOver';
import Auth from './Auth';
import type { AuthProps } from './Auth';
import Settings from './Settings';
import SettingsModal from './SettingsModal';
import HitFeedback from './HitFeedback';
import DashFeedback from './DashFeedback';
import SurvivalEndgame from './SurvivalEndgame';
import Elimination from './Elimination';
import Discover from './Discover';
import TrackBuilder from './TrackBuilder';
import SystemSheet from './SystemSheet';
import Lobby from './Lobby';
import Spectator from './Spectator';
import BetweenRounds from './BetweenRounds';
import CharacterSelect from './CharacterSelect';
import Rewards from './Rewards';
import FinishedOrOut from './FinishedOrOut';
import Ragdoll from './Ragdoll';
import Profile from './Profile';
import Friends from './Friends';
import FriendRequestAlert from './FriendRequestAlert';

/** 1n with the SIGN UP tab open. The tabs switch live either way. */
const AuthSignup = (props: AuthProps) => <Auth {...props} defaultMode="signup" />;

export interface ScreenEntry {
  /** Matches the option id in the HTML mock, so specs are easy to cross-check. */
  id: string;
  name: string;
  Comp: ComponentType<any>;
  /** Every screen in this list is a real port of its design-mock counterpart. */
  built?: boolean;
}

export const SCREENS: ScreenEntry[] = [
  { id: '1a', name: 'Main menu', Comp: MainMenu, built: true },
  { id: '1b', name: 'Race HUD', Comp: RaceHUD, built: true },
  { id: '1c', name: 'Grabbed', Comp: Grabbed, built: true },
  { id: '1d', name: 'Survival endgame', Comp: SurvivalEndgame, built: true },
  { id: '1e', name: 'Elimination', Comp: Elimination, built: true },
  { id: '1f', name: 'Discover', Comp: Discover, built: true },
  { id: '1g', name: 'Track builder', Comp: TrackBuilder, built: true },
  { id: '1h', name: 'System sheet', Comp: SystemSheet, built: true },
  { id: '1i', name: 'Lobby', Comp: Lobby, built: true },
  { id: '1j', name: 'Spectator', Comp: Spectator, built: true },
  { id: '1k', name: 'Between rounds', Comp: BetweenRounds, built: true },
  { id: '1l', name: 'Match over', Comp: MatchOver, built: true },
  { id: '1m', name: 'Character select', Comp: CharacterSelect, built: true },
  { id: '1n', name: 'Log in', Comp: Auth, built: true },
  { id: '1n2', name: 'Sign up', Comp: AuthSignup, built: true },
  { id: '1o', name: 'Settings', Comp: Settings, built: true },
  { id: '1o2', name: 'Settings — in-game', Comp: SettingsModal, built: true },
  { id: '1p', name: 'Rewards', Comp: Rewards, built: true },
  { id: '1q', name: 'Match start countdown', Comp: Countdown, built: true },
  { id: '1r', name: 'Finished / Eliminated', Comp: FinishedOrOut, built: true },
  { id: '1s', name: 'HIT feedback', Comp: HitFeedback, built: true },
  { id: '1t', name: 'DASH feedback', Comp: DashFeedback, built: true },
  { id: '1u', name: 'Ragdoll', Comp: Ragdoll, built: true },
  { id: '1v', name: 'Profile', Comp: Profile, built: true },
  { id: '1w', name: 'Friends', Comp: Friends, built: true },
  { id: '1x', name: 'Friend-request alert', Comp: FriendRequestAlert, built: true },
];

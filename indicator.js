// SPDX-License-Identifier: GPL-3.0-or-later
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {MprisManager} from './mpris.js';

const MAX_PANEL_TEXT_LENGTH = 60;
const MAX_POPUP_TEXT_LENGTH = 30;
const ART_SIZE = 72;
const PROGRESS_WIDTH = 190;
const POPUP_WIDTH = 340;

export class NowBarIndicator extends PanelMenu.Button {
    constructor(name) {
        super(0.0, name, false);

        this._currentArtUrl = null;
        this._artActor = null;
        this._progressTimerId = 0;
        this._seekSendTimerId = 0;
        this._seekEndTimerId = 0;
        this._pendingSeek = null;
        this._updatingSlider = false;
        this._isSeeking = false;

        this.menu.setSourceAlignment(0.0);
        this.menu.box.set_width(POPUP_WIDTH);

        this._buildPanel();
        this._buildMediaInfo();
        this._buildProgress();
        this._buildControls();

        this._menuOpenSignalId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._startProgressTimer();
            else
                this._stopProgressTimer();
        });

        this._mpris = new MprisManager(() => this._update());
        this._update();
    }

    _buildPanel() {
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._panelIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'system-status-icon',
        });
        this._panelLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nowbar-panel-label',
        });

        box.add_child(this._panelIcon);
        box.add_child(this._panelLabel);
        this.add_child(box);
    }

    _buildMediaInfo() {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._artBin = new St.Bin({
            width: ART_SIZE,
            height: ART_SIZE,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nowbar-art-bin',
        });
        this._artPlaceholder = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 28,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nowbar-art-placeholder',
        });
        this._artBin.set_child(this._artPlaceholder);

        const infoBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._titleLabel = new St.Label({text: '', style_class: 'nowbar-title'});
        this._artistLabel = new St.Label({text: '', style_class: 'nowbar-artist'});
        this._albumLabel = new St.Label({text: '', style_class: 'nowbar-album'});

        infoBox.add_child(this._titleLabel);
        infoBox.add_child(this._artistLabel);
        infoBox.add_child(this._albumLabel);
        box.add_child(this._artBin);
        box.add_child(infoBox);
        item.add_child(box);
        this.menu.addMenuItem(item);
    }

    _buildProgress() {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._elapsedLabel = new St.Label({
            text: '0:00',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nowbar-time nowbar-time-left',
        });
        this._progressSlider = new Slider(0);
        this._progressSlider.set_width(PROGRESS_WIDTH);
        this._progressSlider.accessible_name = 'Track position';
        this._sliderSignalId = this._progressSlider.connect('notify::value', () => {
            this._onSliderChanged();
        });
        this._durationLabel = new St.Label({
            text: '0:00',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'nowbar-time nowbar-time-right',
        });

        box.add_child(this._elapsedLabel);
        box.add_child(this._progressSlider);
        box.add_child(this._durationLabel);
        item.add_child(box);
        this.menu.addMenuItem(item);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    _buildControls() {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._previousButton = this._createControlButton('media-skip-backward-symbolic');
        this._playPauseIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            icon_size: 16,
        });
        this._playPauseButton = new St.Button({
            style_class: 'button nowbar-control-button nowbar-play-pause-button',
            can_focus: true,
            child: this._playPauseIcon,
        });
        this._nextButton = this._createControlButton('media-skip-forward-symbolic');

        this._previousSignalId = this._previousButton.connect('clicked', () => this._mpris.previous());
        this._playPauseSignalId = this._playPauseButton.connect('clicked', () => {
            this._mpris.playPause();
            this._refreshProgress();
        });
        this._nextSignalId = this._nextButton.connect('clicked', () => this._mpris.next());

        box.add_child(this._previousButton);
        box.add_child(this._playPauseButton);
        box.add_child(this._nextButton);
        item.add_child(box);
        this.menu.addMenuItem(item);
    }

    _createControlButton(iconName) {
        return new St.Button({
            style_class: 'button nowbar-control-button',
            can_focus: true,
            child: new St.Icon({icon_name: iconName, icon_size: 16}),
        });
    }

    _truncate(text, maxLength) {
        if (!text)
            return '';
        return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
    }

    _formatTime(microseconds) {
        const totalSeconds = Math.max(0, Math.floor(Number(microseconds) / 1_000_000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0)
            return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    _onSliderChanged() {
        if (this._updatingSlider || !this._mpris)
            return;

        const media = this._mpris.currentMedia;
        if (!media?.canSeek || !media.length || !media.trackId)
            return;

        const fraction = Math.max(0, Math.min(1, Number(this._progressSlider.value)));
        const position = Math.round(Number(media.length) * fraction);
        this._isSeeking = true;
        this._elapsedLabel.text = this._formatTime(position);
        this._pendingSeek = {trackId: media.trackId, position};

        if (!this._seekSendTimerId) {
            this._seekSendTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
                this._seekSendTimerId = 0;
                const seek = this._pendingSeek;
                this._pendingSeek = null;
                if (seek)
                    this._mpris.setPosition(seek.trackId, seek.position);
                return GLib.SOURCE_REMOVE;
            });
        }

        if (this._seekEndTimerId) {
            GLib.Source.remove(this._seekEndTimerId);
            this._seekEndTimerId = 0;
        }
        this._seekEndTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._seekEndTimerId = 0;
            this._isSeeking = false;
            this._refreshProgress();
            return GLib.SOURCE_REMOVE;
        });
    }

    _startProgressTimer() {
        if (this._progressTimerId) {
            GLib.Source.remove(this._progressTimerId);
            this._progressTimerId = 0;
        }

        this._refreshProgress();
        this._progressTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._refreshProgress();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopProgressTimer() {
        if (!this._progressTimerId)
            return;

        GLib.Source.remove(this._progressTimerId);
        this._progressTimerId = 0;
    }

    _refreshProgress() {
        if (!this._mpris || this._isSeeking)
            return;

        const media = this._mpris.currentMedia;
        if (!media?.length) {
            this._elapsedLabel.text = '0:00';
            this._durationLabel.text = '0:00';
            this._setSliderValue(0);
            return;
        }

        const trackId = media.trackId;
        const duration = Number(media.length);
        this._durationLabel.text = this._formatTime(duration);

        this._mpris.getPosition(position => {
            if (!this._mpris)
                return;

            const current = this._mpris.currentMedia;
            if (!current || current.trackId !== trackId)
                return;

            const safePosition = Math.max(0, Math.min(Number(position), duration));
            this._setSliderValue(duration > 0 ? safePosition / duration : 0);
            this._elapsedLabel.text = this._formatTime(safePosition);
        });
    }

    _setSliderValue(value) {
        this._updatingSlider = true;
        this._progressSlider.value = Math.max(0, Math.min(1, Number(value) || 0));
        this._updatingSlider = false;
    }

    _update() {
        if (!this._mpris)
            return;

        const media = this._mpris.currentMedia;
        if (!media) {
            this.hide();
            return;
        }

        const panelText = media.artist && media.title
            ? `${media.artist} — ${media.title}`
            : media.title || media.artist || 'Media';
        this._panelLabel.text = this._truncate(panelText, MAX_PANEL_TEXT_LENGTH);
        this._titleLabel.text = this._truncate(media.title || 'Unknown title', MAX_POPUP_TEXT_LENGTH);
        this._artistLabel.text = this._truncate(media.artist || 'Unknown artist', MAX_POPUP_TEXT_LENGTH);

        if (media.album) {
            this._albumLabel.text = this._truncate(media.album, MAX_POPUP_TEXT_LENGTH);
            this._albumLabel.show();
        } else {
            this._albumLabel.hide();
        }

        this._durationLabel.text = media.length ? this._formatTime(media.length) : '0:00';
        this._progressSlider.reactive = media.canSeek;
        this._progressSlider.can_focus = media.canSeek;
        this._progressSlider.opacity = media.canSeek ? 255 : 128;
        this._updateArt(media.artUrl);

        const iconName = media.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._panelIcon.icon_name = iconName;
        this._playPauseIcon.icon_name = iconName;
        this.show();

        if (this.menu.isOpen)
            this._refreshProgress();
    }

    _updateArt(artUrl) {
        if (artUrl === this._currentArtUrl)
            return;

        this._currentArtUrl = artUrl;
        if (this._artActor) {
            this._artActor.destroy();
            this._artActor = null;
        }

        if (!artUrl) {
            this._artBin.set_child(this._artPlaceholder);
            return;
        }

        try {
            const file = artUrl.includes('://')
                ? Gio.File.new_for_uri(artUrl)
                : Gio.File.new_for_path(artUrl);
            const themeContext = St.ThemeContext.get_for_stage(global.stage);
            const resourceScale = Math.max(1.0, this._artBin.get_resource_scale());

            this._artActor = St.TextureCache.get_default().load_file_async(
                file,
                ART_SIZE,
                ART_SIZE,
                themeContext.scale_factor,
                resourceScale
            );
            this._artActor.set_size(ART_SIZE, ART_SIZE);
            this._artBin.set_child(this._artActor);
        } catch (error) {
            console.warn(`[NowBar] Artwork load failed: ${error.message}`);
            this._artActor = null;
            this._artBin.set_child(this._artPlaceholder);
        }
    }

    destroy() {
        this._stopProgressTimer();

        if (this._seekSendTimerId) {
            GLib.Source.remove(this._seekSendTimerId);
            this._seekSendTimerId = 0;
        }
        if (this._seekEndTimerId) {
            GLib.Source.remove(this._seekEndTimerId);
            this._seekEndTimerId = 0;
        }

        this._progressSlider.disconnect(this._sliderSignalId);
        this._previousButton.disconnect(this._previousSignalId);
        this._playPauseButton.disconnect(this._playPauseSignalId);
        this._nextButton.disconnect(this._nextSignalId);
        this.menu.disconnect(this._menuOpenSignalId);

        this._mpris.destroy();
        this._mpris = null;
        this._pendingSeek = null;
        this._artActor = null;
        this._artPlaceholder = null;
        this._artBin = null;
        this._panelIcon = null;
        this._panelLabel = null;
        this._titleLabel = null;
        this._artistLabel = null;
        this._albumLabel = null;
        this._elapsedLabel = null;
        this._durationLabel = null;
        this._progressSlider = null;
        this._previousButton = null;
        this._playPauseButton = null;
        this._playPauseIcon = null;
        this._nextButton = null;

        super.destroy();
    }
}

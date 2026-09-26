import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {
    Extension,
} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main
    from 'resource:///org/gnome/shell/ui/main.js';

import * as PanelMenu
    from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as PopupMenu
    from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    Slider,
} from 'resource:///org/gnome/shell/ui/slider.js';

import {
    MprisManager,
} from './mpris.js';


const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

const MAX_PANEL_TEXT_LENGTH = 60;

const MAX_POPUP_TITLE_LENGTH = 30;
const MAX_POPUP_ARTIST_LENGTH = 30;
const MAX_POPUP_ALBUM_LENGTH = 30;

const ART_SIZE = 72;

/*
 * Ширина полосы прогресса.
 */
const PROGRESS_WIDTH = 190;

/*
 * Фиксированная ширина popup.
 */
const POPUP_WIDTH = 340;


export default class MyMediaExtension extends Extension {
    enable() {
        this._currentArtUrl = null;
        this._artActor = null;

        this._progressTimerId = 0;
        this._progressSliderSignalId = 0;

        this._updatingProgressSlider = false;
        this._isSeeking = false;

        this._seekEndTimerId = 0;
        this._seekSendTimerId = 0;

        this._pendingSeek = null;


        /*
         * ======================================
         * Верхняя панель
         * ======================================
         */

        this._indicator =
            new PanelMenu.Button(
                0.0,
                this.metadata.name,
                false
            );


        /*
         * ======================================
         * Фиксируем popup
         * ======================================
         *
         * 0.0 = popup привязан к левому краю
         * индикатора, а не к его центру.
         *
         * Благодаря этому изменение длины
         * Artist — Track не должно двигать окно.
         */

        this._indicator.menu.setSourceAlignment(
            0.0
        );

        this._indicator.menu.box.set_width(
            POPUP_WIDTH
        );


        this._panelBox =
            new St.BoxLayout({
                orientation:
                    Clutter.Orientation.HORIZONTAL,

                y_align:
                    Clutter.ActorAlign.CENTER,
            });


        this._panelIcon =
            new St.Icon({
                icon_name:
                    'media-playback-start-symbolic',

                style_class:
                    'system-status-icon',
            });


        this._panelLabel =
            new St.Label({
                text: '',

                y_align:
                    Clutter.ActorAlign.CENTER,

                style:
                    'margin-left: 6px;',
            });


        this._panelBox.add_child(
            this._panelIcon
        );

        this._panelBox.add_child(
            this._panelLabel
        );

        this._indicator.add_child(
            this._panelBox
        );


        /*
         * ======================================
         * Обложка + информация
         * ======================================
         */

        this._mediaItem =
            new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });


        this._mediaBox =
            new St.BoxLayout({
                orientation:
                    Clutter.Orientation.HORIZONTAL,

                x_expand: true,

                y_align:
                    Clutter.ActorAlign.CENTER,
            });


        /*
         * Обложка.
         */

        this._artBin =
            new St.Bin({
                width: ART_SIZE,
                height: ART_SIZE,

                x_align:
                    Clutter.ActorAlign.CENTER,

                y_align:
                    Clutter.ActorAlign.CENTER,

                style: `
                    width: ${ART_SIZE}px;
                    height: ${ART_SIZE}px;

                    margin-right: 12px;

                    background-color:
                        rgba(128, 128, 128, 0.12);

                    border-radius: 8px;
                `,
            });


        this._artPlaceholder =
            new St.Icon({
                icon_name:
                    'audio-x-generic-symbolic',

                icon_size: 28,

                x_align:
                    Clutter.ActorAlign.CENTER,

                y_align:
                    Clutter.ActorAlign.CENTER,

                style:
                    'opacity: 0.45;',
            });


        this._artBin.set_child(
            this._artPlaceholder
        );


        /*
         * Информация справа от обложки.
         */

        this._infoBox =
            new St.BoxLayout({
                orientation:
                    Clutter.Orientation.VERTICAL,

                x_expand: true,

                y_align:
                    Clutter.ActorAlign.CENTER,
            });


        this._titleLabel =
            new St.Label({
                text: '',

                style: `
                    font-weight: bold;
                    font-size: 1.05em;
                `,
            });


        this._artistLabel =
            new St.Label({
                text: '',

                style: `
                    opacity: 0.75;
                    margin-top: 3px;
                `,
            });


        this._albumLabel =
            new St.Label({
                text: '',

                style: `
                    opacity: 0.5;
                    font-size: 0.9em;
                    margin-top: 2px;
                `,
            });


        this._infoBox.add_child(
            this._titleLabel
        );

        this._infoBox.add_child(
            this._artistLabel
        );

        this._infoBox.add_child(
            this._albumLabel
        );


        this._mediaBox.add_child(
            this._artBin
        );

        this._mediaBox.add_child(
            this._infoBox
        );


        this._mediaItem.add_child(
            this._mediaBox
        );


        this._indicator.menu.addMenuItem(
            this._mediaItem
        );


        /*
         * ======================================
         * Progress / перемотка
         * ======================================
         */

        this._progressItem =
            new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });


        this._progressBox =
            new St.BoxLayout({
                orientation:
                    Clutter.Orientation.HORIZONTAL,

                x_expand: true,

                x_align:
                    Clutter.ActorAlign.CENTER,

                y_align:
                    Clutter.ActorAlign.CENTER,
            });


        /*
         * Прошедшее время.
         */

        this._elapsedLabel =
            new St.Label({
                text: '0:00',

                y_align:
                    Clutter.ActorAlign.CENTER,

                style: `
                    font-size: 0.8em;
                    opacity: 0.65;
                    margin-right: 8px;
                `,
            });


        /*
         * Полоса прогресса.
         */

        this._progressSlider =
            new Slider(0);


        this._progressSlider.set_width(
            PROGRESS_WIDTH
        );


        this._progressSlider.accessible_name =
            'Track position';


        this._progressSliderSignalId =
            this._progressSlider.connect(
                'notify::value',
                () => {
                    this._onProgressSliderChanged();
                }
            );


        /*
         * Полная длительность.
         */

        this._durationLabel =
            new St.Label({
                text: '0:00',

                y_align:
                    Clutter.ActorAlign.CENTER,

                style: `
                    font-size: 0.8em;
                    opacity: 0.65;
                    margin-left: 8px;
                `,
            });


        this._progressBox.add_child(
            this._elapsedLabel
        );

        this._progressBox.add_child(
            this._progressSlider
        );

        this._progressBox.add_child(
            this._durationLabel
        );


        this._progressItem.add_child(
            this._progressBox
        );


        this._indicator.menu.addMenuItem(
            this._progressItem
        );


        /*
         * Разделитель.
         */

        this._indicator.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem()
        );


        /*
         * ======================================
         * Кнопки управления
         * ======================================
         */

        this._controlsItem =
            new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false,
            });


        this._controlsBox =
            new St.BoxLayout({
                orientation:
                    Clutter.Orientation.HORIZONTAL,

                x_expand: true,

                x_align:
                    Clutter.ActorAlign.CENTER,
            });


        /*
         * Previous.
         */

        this._previousButton =
            new St.Button({
                style_class:
                    'button',

                can_focus: true,

                child:
                    new St.Icon({
                        icon_name:
                            'media-skip-backward-symbolic',

                        icon_size: 16,
                    }),

                style: `
                    padding: 5px 8px;
                    margin: 0 2px;
                `,
            });


        this._previousButton.connect(
            'clicked',
            () => {
                this._mpris?.previous();
            }
        );


        /*
         * Play / Pause.
         */

        this._playPauseIcon =
            new St.Icon({
                icon_name:
                    'media-playback-start-symbolic',

                icon_size: 16,
            });


        this._playPauseButton =
            new St.Button({
                style_class:
                    'button',

                can_focus: true,

                child:
                    this._playPauseIcon,

                style: `
                    padding: 5px 9px;
                    margin: 0 2px;
                `,
            });


        this._playPauseButton.connect(
            'clicked',
            () => {
                this._mpris?.playPause();

                this._refreshProgress();
            }
        );


        /*
         * Next.
         */

        this._nextButton =
            new St.Button({
                style_class:
                    'button',

                can_focus: true,

                child:
                    new St.Icon({
                        icon_name:
                            'media-skip-forward-symbolic',

                        icon_size: 16,
                    }),

                style: `
                    padding: 5px 8px;
                    margin: 0 2px;
                `,
            });


        this._nextButton.connect(
            'clicked',
            () => {
                this._mpris?.next();
            }
        );


        this._controlsBox.add_child(
            this._previousButton
        );

        this._controlsBox.add_child(
            this._playPauseButton
        );

        this._controlsBox.add_child(
            this._nextButton
        );


        this._controlsItem.add_child(
            this._controlsBox
        );


        this._indicator.menu.addMenuItem(
            this._controlsItem
        );


        /*
         * ======================================
         * Левая часть панели GNOME
         * ======================================
         */

        Main.panel.addToStatusArea(
            this.uuid,
            this._indicator,
            1,
            'left'
        );


        /*
         * Progress обновляем,
         * пока popup открыт.
         */

        this._menuOpenSignal =
            this._indicator.menu.connect(
                'open-state-changed',

                (_menu, isOpen) => {
                    if (isOpen)
                        this._startProgressTimer();
                    else
                        this._stopProgressTimer();
                }
            );


        /*
         * MPRIS.
         */

        this._mpris =
            new MprisManager(
                () => this._update()
            );


        this._update();
    }


    /*
     * Обрезание длинного текста.
     */

    _truncate(text, length) {
        if (!text)
            return '';

        if (text.length <= length)
            return text;

        return `${text.slice(
            0,
            length - 1
        )}…`;
    }


    /*
     * Микросекунды -> 0:00
     */

    _formatTime(microseconds) {
        const totalSeconds =
            Math.max(
                0,

                Math.floor(
                    Number(microseconds) /
                    1_000_000
                )
            );


        const hours =
            Math.floor(
                totalSeconds / 3600
            );


        const minutes =
            Math.floor(
                (totalSeconds % 3600) /
                60
            );


        const seconds =
            totalSeconds % 60;


        if (hours > 0) {
            return (
                `${hours}:` +
                `${String(minutes).padStart(
                    2,
                    '0'
                )}:` +
                `${String(seconds).padStart(
                    2,
                    '0'
                )}`
            );
        }


        return (
            `${minutes}:` +
            `${String(seconds).padStart(
                2,
                '0'
            )}`
        );
    }


    /*
     * ======================================
     * Перемотка
     * ======================================
     */

    _onProgressSliderChanged() {
        if (this._updatingProgressSlider)
            return;


        if (!this._mpris)
            return;


        const media =
            this._mpris.currentMedia;


        if (
            !media ||
            !media.length ||
            !media.trackId ||
            !media.name
        ) {
            return;
        }


        const duration =
            Number(media.length);


        if (duration <= 0)
            return;


        const fraction =
            Math.max(
                0,

                Math.min(
                    1,

                    Number(
                        this._progressSlider.value
                    )
                )
            );


        const newPosition =
            Math.round(
                duration * fraction
            );


        this._isSeeking = true;


        this._elapsedLabel.text =
            this._formatTime(
                newPosition
            );


        this._pendingSeek = {
            playerName:
                media.name,

            trackId:
                media.trackId,

            position:
                newPosition,
        };


        if (!this._seekSendTimerId) {
            this._seekSendTimerId =
                GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,

                    60,

                    () => {
                        this._seekSendTimerId =
                            0;


                        const seek =
                            this._pendingSeek;


                        this._pendingSeek =
                            null;


                        if (seek) {
                            this._setPosition(
                                seek.playerName,
                                seek.trackId,
                                seek.position
                            );
                        }


                        return GLib.SOURCE_REMOVE;
                    }
                );
        }


        if (this._seekEndTimerId) {
            GLib.source_remove(
                this._seekEndTimerId
            );

            this._seekEndTimerId = 0;
        }


        this._seekEndTimerId =
            GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,

                300,

                () => {
                    this._seekEndTimerId =
                        0;

                    this._isSeeking =
                        false;

                    this._refreshProgress();

                    return GLib.SOURCE_REMOVE;
                }
            );
    }


    /*
     * MPRIS SetPosition.
     */

    _setPosition(
        playerName,
        trackId,
        position
    ) {
        try {
            Gio.DBus.session.call(
                playerName,

                MPRIS_PATH,

                PLAYER_IFACE,

                'SetPosition',

                new GLib.Variant(
                    '(ox)',

                    [
                        trackId,
                        position,
                    ]
                ),

                null,

                Gio.DBusCallFlags.NONE,

                -1,

                null,

                (
                    connection,
                    result
                ) => {
                    try {
                        connection.call_finish(
                            result
                        );
                    } catch (error) {
                        console.warn(
                            `[My Media] SetPosition failed: ${error.message}`
                        );
                    }
                }
            );
        } catch (error) {
            console.warn(
                `[My Media] SetPosition failed: ${error.message}`
            );
        }
    }


    /*
     * ======================================
     * Progress timer
     * ======================================
     */

    _startProgressTimer() {
        this._stopProgressTimer();

        this._refreshProgress();


        this._progressTimerId =
            GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,

                1,

                () => {
                    this._refreshProgress();

                    return GLib.SOURCE_CONTINUE;
                }
            );
    }


    _stopProgressTimer() {
        if (this._progressTimerId) {
            GLib.source_remove(
                this._progressTimerId
            );

            this._progressTimerId = 0;
        }
    }


    _refreshProgress() {
        if (!this._mpris)
            return;


        if (this._isSeeking)
            return;


        const media =
            this._mpris.currentMedia;


        if (
            !media ||
            !media.length
        ) {
            this._elapsedLabel.text =
                '0:00';

            this._durationLabel.text =
                '0:00';


            this._setProgressSliderValue(
                0
            );

            return;
        }


        const trackId =
            media.trackId;


        const duration =
            Number(
                media.length
            );


        this._durationLabel.text =
            this._formatTime(
                duration
            );


        this._mpris.getPosition(
            position => {
                if (!this._mpris)
                    return;


                const current =
                    this._mpris.currentMedia;


                if (!current)
                    return;


                if (
                    current.trackId !==
                    trackId
                ) {
                    return;
                }


                const safePosition =
                    Math.max(
                        0,

                        Math.min(
                            Number(position),
                            duration
                        )
                    );


                const fraction =
                    duration > 0
                        ? safePosition /
                            duration
                        : 0;


                this._setProgressSliderValue(
                    fraction
                );


                this._elapsedLabel.text =
                    this._formatTime(
                        safePosition
                    );
            }
        );
    }


    /*
     * Меняем Slider без перемотки.
     */

    _setProgressSliderValue(value) {
        if (!this._progressSlider)
            return;


        const safeValue =
            Math.max(
                0,

                Math.min(
                    1,
                    Number(value) || 0
                )
            );


        this._updatingProgressSlider =
            true;


        this._progressSlider.value =
            safeValue;


        this._updatingProgressSlider =
            false;
    }


    /*
     * ======================================
     * Основное обновление
     * ======================================
     */

    _update() {
        if (!this._indicator)
            return;


        const media =
            this._mpris?.currentMedia;


        if (!media) {
            this._indicator.hide();

            return;
        }


        const {
            artist,
            title,
            album,
            artUrl,
            status,
            length,
        } = media;


        /*
         * Верхняя панель.
         */

        let panelText;


        if (artist && title) {
            panelText =
                `${artist} — ${title}`;
        } else {
            panelText =
                title ||
                artist ||
                'Media';
        }


        panelText =
            this._truncate(
                panelText,
                MAX_PANEL_TEXT_LENGTH
            );


        this._panelLabel.text =
            panelText;


        /*
         * Popup.
         */

        this._titleLabel.text =
            this._truncate(
                title ||
                'Unknown title',

                MAX_POPUP_TITLE_LENGTH
            );


        this._artistLabel.text =
            this._truncate(
                artist ||
                'Unknown artist',

                MAX_POPUP_ARTIST_LENGTH
            );


        if (album) {
            this._albumLabel.text =
                this._truncate(
                    album,
                    MAX_POPUP_ALBUM_LENGTH
                );

            this._albumLabel.show();
        } else {
            this._albumLabel.hide();
        }


        /*
         * Duration.
         */

        if (length) {
            this._durationLabel.text =
                this._formatTime(
                    length
                );
        } else {
            this._durationLabel.text =
                '0:00';
        }


        /*
         * Обложка.
         */

        this._updateArt(
            artUrl
        );


        /*
         * Play / Pause.
         */

        if (status === 'Playing') {
            this._panelIcon.icon_name =
                'media-playback-pause-symbolic';


            this._playPauseIcon.icon_name =
                'media-playback-pause-symbolic';

        } else {
            this._panelIcon.icon_name =
                'media-playback-start-symbolic';


            this._playPauseIcon.icon_name =
                'media-playback-start-symbolic';
        }


        this._indicator.show();


        if (this._indicator.menu.isOpen)
            this._refreshProgress();
    }


    /*
     * ======================================
     * Artwork
     * ======================================
     */

    _updateArt(artUrl) {
        if (
            artUrl ===
            this._currentArtUrl
        ) {
            return;
        }


        this._currentArtUrl =
            artUrl;


        if (this._artActor) {
            this._artActor.destroy();

            this._artActor =
                null;
        }


        if (!artUrl) {
            this._artBin.set_child(
                this._artPlaceholder
            );

            return;
        }


        try {
            let file;


            if (
                artUrl.includes(
                    '://'
                )
            ) {
                file =
                    Gio.File.new_for_uri(
                        artUrl
                    );
            } else {
                file =
                    Gio.File.new_for_path(
                        artUrl
                    );
            }


            const themeContext =
                St.ThemeContext.get_for_stage(
                    global.stage
                );


            const paintScale =
                themeContext.scale_factor;


            const resourceScale =
                Math.max(
                    1.0,

                    this._artBin
                        .get_resource_scale()
                );


            const textureCache =
                St.TextureCache.get_default();


            this._artActor =
                textureCache.load_file_async(
                    file,

                    ART_SIZE,
                    ART_SIZE,

                    paintScale,
                    resourceScale
                );


            this._artActor.set_size(
                ART_SIZE,
                ART_SIZE
            );


            this._artBin.set_child(
                this._artActor
            );

        } catch (error) {
            console.warn(
                `[My Media] Failed to load artwork: ${error.message}`
            );


            this._artActor =
                null;


            this._artBin.set_child(
                this._artPlaceholder
            );
        }
    }


    /*
     * ======================================
     * Disable
     * ======================================
     */

    disable() {
        this._stopProgressTimer();


        if (this._seekSendTimerId) {
            GLib.source_remove(
                this._seekSendTimerId
            );

            this._seekSendTimerId = 0;
        }


        if (this._seekEndTimerId) {
            GLib.source_remove(
                this._seekEndTimerId
            );

            this._seekEndTimerId = 0;
        }


        this._pendingSeek = null;


        if (
            this._progressSlider &&
            this._progressSliderSignalId
        ) {
            this._progressSlider.disconnect(
                this._progressSliderSignalId
            );

            this._progressSliderSignalId = 0;
        }


        if (
            this._indicator &&
            this._menuOpenSignal
        ) {
            this._indicator.menu.disconnect(
                this._menuOpenSignal
            );

            this._menuOpenSignal = 0;
        }


        this._mpris?.destroy();
        this._mpris = null;


        this._indicator?.destroy();


        this._indicator = null;

        this._panelBox = null;
        this._panelIcon = null;
        this._panelLabel = null;

        this._mediaItem = null;
        this._mediaBox = null;

        this._artBin = null;
        this._artPlaceholder = null;
        this._artActor = null;

        this._infoBox = null;

        this._titleLabel = null;
        this._artistLabel = null;
        this._albumLabel = null;

        this._progressItem = null;
        this._progressBox = null;
        this._progressSlider = null;

        this._elapsedLabel = null;
        this._durationLabel = null;

        this._controlsItem = null;
        this._controlsBox = null;

        this._previousButton = null;

        this._playPauseButton = null;
        this._playPauseIcon = null;

        this._nextButton = null;

        this._currentArtUrl = null;

        this._updatingProgressSlider = false;
        this._isSeeking = false;
    }
}

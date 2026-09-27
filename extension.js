// SPDX-License-Identifier: GPL-3.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {NowBarIndicator} from './indicator.js';

export default class NowBarExtension extends Extension {
    enable() {
        this._indicator = new NowBarIndicator(this.metadata.name);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'left');
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

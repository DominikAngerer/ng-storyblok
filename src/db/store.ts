/**
 * @license
 * Copyright (c) 2016 Thomas Pink
 *
 * Use of this source code is governed by the MIT-style license that can be
 * found in the LICENSE file at https://github.com/thomaspink/ng-storyblok/blob/master/LICENSE
 */

import { Injectable } from '@angular/core';
import { SBStory } from './model';
import { SBAdapter } from './adapter';
import { SBSerializer } from './serializer';
import { Observable } from 'rxjs/Observable';
import { Observer } from 'rxjs/Observer';
import 'rxjs/add/operator/map';

/**
 * The SBStore will store, load, fetch and normalize stories.
 * You can use high-level methods for subscribing, loading,
 * finding and peeking stories.
 * 
 * @export
 * @class SBStore
 */
@Injectable()
export abstract class SBStore  {
  
  /**
   * Get an Observable on a story by a given slug or ID. When subscribing
   * or switching it to the "hot"" state, the method will lookup the story
   * from the story or otherwise fetch it from the adapter. Everytime the
   * story changes, gets updated or reloaded (see `reloadStory`) the
   * Observer will call next with the new resolved story.
   *
   * For more information on Observables or Observers have a look on RxJS:
   * http://reactivex.io/rxjs/
   * 
   * @param {(string | number)} slugOrId
   * @param {string} [version]
   * @returns {Observable<SBStory>}
   * 
   * @memberOf SBStore
   */
  abstract story(slugOrId: string | number, version?: string): Observable<SBStory>;

  /**
   * Get a story by a given slug or ID by looking up the story from the store if it is
   * available, otherwise it will trigger a fetch from the server.
   *
   * This method will asynchronously peek the story from the store. If the story is not
   * present in the store (cache), it will be loaded by the adapters `fetchStory` method.
   * A story is available if it has been fetched earlier.
   *
   * 
   * @param {(number | string)} slugOrId
   * @param {string} [version]
   * @returns {Promise<SBStory>}
   * 
   * @memberOf SBStore
   */
  abstract findStory(slugOrId: number | string, version?: string): Promise<SBStory>;

  /**
   * Get a story by a given slug or ID without triggering a fetch.
   *
   * This method will synchronously return the story if it is available in the store, otherwise it will return `undefined`.
   * A story is available if it has been fetched earlier.
   * 
   * @param {(number | string)} slugOrId
   * @param {string} [version]
   * @returns {SBStory}
   * 
   * @memberOf SBStore
   */
  abstract peekStory(slugOrId: number | string, version?: string): SBStory;

  /**
   * Get a story by a given slug or ID by triggering a fetch on the adapter
   * and loading it fresh from the server.
   *
   * This method will asynchronously fetch the story from the adapter and return a Promise
   * that will be resolved with the story.
   * 
   * @param {(number | string)} slugOrId
   * @param {string} [version]
   * @returns {Promise<SBStory>}
   * 
   * @memberOf SBStore
   */
  abstract loadStory(slugOrId: number | string, version?: string): Promise<SBStory>;

  /**
   * This method will asynchronously load a story again by calling `fetchStory` on the adapter
   * and update the story in the story.
   * 
   * @param {SBStory} story
   * @returns {Promise<SBStory>}
   * 
   * @memberOf SBStore
   */
  abstract reloadStory(story: SBStory): Promise<SBStory>;
}

let __UNDEFINED__;

@Injectable()
export class SBDefaultStore implements SBStore {

  private _stories: { story: SBStory; version?: string; observers: Observer<SBStory>[] }[] = [];
  private _lastPeekedStory: { story: SBStory; version?: string; observers: Observer<SBStory>[] };

  constructor(private _adapter: SBAdapter, private _serializer: SBSerializer) { }

  /* @override */   
  story(slugOrId: string | number, version?: string): Observable<SBStory> {
    return Observable.create((observer: Observer<SBStory>) => {
      this.findStory(slugOrId, version).then(s => {
        this._peekStoryObject(slugOrId, version).observers.push(observer);
        this._notifyStoryUpdate(s);
      });
    });
  }

  /* @override */ 
  findStory(slugOrId: number | string, version?: string): Promise<SBStory> {
    const result = this.peekStory(slugOrId, version);
    if (result)
      return new Promise(resolve => resolve(result));
    else
      return this.loadStory(slugOrId, version);  
  }

  /* @override */  
  peekStory(slugOrId: number | string, version?: string): SBStory {
    const result = this._peekStoryObject(slugOrId, version);
    return !!result ? result.story : __UNDEFINED__;
  }

  /* @override */  
  loadStory(slugOrId: number | string, version?: string): Promise<SBStory> {
    return this._adapter.fetchStory(slugOrId, version).then(s => {
      const story = this._serializer.normalizeStory(s)
      this._setStoryObject(story, version);
      this._notifyStoryUpdate(story); 
      return story;
    });
  }

  /* @override */
  reloadStory(story: SBStory): Promise<SBStory> {
    return this.loadStory(story.id, this._getVersion(story));
  }

  /* @internal */  
  private _peekStoryObject(slugOrId: number | string, version?: string):
    { story: SBStory; version?: string; observers: Observer<SBStory>[] } {
    const id = typeof slugOrId === 'number' && slugOrId;
    const slug = typeof slugOrId === 'string' && slugOrId;
    if (this._lastPeekedStory && this._lastPeekedStory.story &&
       (this._lastPeekedStory.story.id === id || this._lastPeekedStory.story.slug === slug))
      return this._lastPeekedStory;
    this._lastPeekedStory = this._stories.find(s => {
      return (s.story.id === id || s.story.slug === slug) && !version || (!!version && s.version === version);
    });
    return this._lastPeekedStory || __UNDEFINED__;
  }

  /* @internal */  
  private _setStoryObject(story: SBStory, version?: string) {
    let result = this._peekStoryObject(story.id, version);
    if (result)
      result.story = story;
    else
      this._stories.push({
        story: story,
        version: version,
        observers: []
      });
  }

  /* @internal */  
  private _getVersion(story: SBStory) {
    const res = this._peekStoryObject(story.id);
    return res && res.version;
  }

  /* @internal */  
  private _notifyStoryUpdate(story: SBStory, version?: string) {
    const obj = this._peekStoryObject(story.id, version);
    if (obj && obj.observers)
      obj.observers.forEach(o => o.next(story));  
  }

}
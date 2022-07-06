/* This class contains information about what trackers and sites
 * are on a given tab:
 *  id: Chrome tab id
 *  url: url of the tab
 *  site: ref to a Site object
 *  trackers: {object} all trackers requested on page/tab (listed by company)
 *  trackersBlocked: {object} tracker instances we blocked on page/tab (listed by company)
 *      both `trackers` and `trackersBlocked` objects are in this format:
 *      {
 *         '<companyName>': {
 *              parentCompany: ref to a Company object
 *              urls: all unique tracker urls we have seen for this company
 *              count: total number of requests to unique tracker urls for this company
 *          }
 *      }
 */

const Site = require('./site.es6')
const Tracker = require('./tracker.es6')
const HttpsRedirects = require('./https-redirects.es6')
const Companies = require('../companies.es6')
const webResourceKeyRegex = /.*\?key=(.*)/

class Tab {
    constructor (tabData) {
        this.id = tabData.id || tabData.tabId
        this.trackers = {}
        this.trackersBlocked = {}
        this.url = tabData.url
        this.upgradedHttps = false
        this.hasHttpsError = false
        this.mainFrameUpgraded = false
        this.urlParametersRemoved = false
        this.urlParametersRemovedUrl = null
        this.ampUrl = null
        this.cleanAmpUrl = null
        this.requestId = tabData.requestId
        this.status = tabData.status

        // Consider the site URL to be the request initiator for requests fired
        // inside opaque 'tabs' (e.g. via ServiceWorkers). Otherwise, consider
        // the site URL to be the request URL.
        const requestInitiator = tabData.initiator || tabData.originUrl
        if (this.id === -1 && requestInitiator) {
            this.site = new Site(requestInitiator)
        } else {
            this.site = new Site(this.url)
        }

        this.httpsRedirects = new HttpsRedirects()
        this.statusCode = null // statusCode is set when headers are received in tabManager.js
        this.stopwatch = {
            begin: Date.now(),
            end: null,
            completeMs: null
        }
        this.webResourceAccess = []
        this.surrogates = {}
    };

    updateSite (url) {
        if (this.site.url === url) return

        this.url = url
        this.site = new Site(url)

        // reset badge to dax whenever we go to a new site
    };

    // Store all trackers for a given tab even if we don't block them.
    addToTrackers (t) {
        const tracker = this.trackers[t.tracker.owner.name]
        if (tracker) {
            tracker.increment()
            tracker.update(t)
        } else {
            const newTracker = new Tracker(t)
            this.trackers[t.tracker.owner.name] = newTracker

            // first time we have seen this network tracker on the page
            if (t.tracker.owner.name !== 'unknown') Companies.countCompanyOnPage(t.tracker.owner)

            return newTracker
        }
    };

    addOrUpdateTrackersBlocked (t) {
        const tracker = this.trackersBlocked[t.tracker.owner.name]
        if (tracker) {
            tracker.increment()
            tracker.update(t)
        } else {
            const newTracker = new Tracker(t)
            this.trackersBlocked[newTracker.parentCompany.name] = newTracker
            return newTracker
        }
    };

    endStopwatch () {
        // @ts-ignore
        this.stopwatch.end = Date.now()
        // @ts-ignore
        this.stopwatch.completeMs = (this.stopwatch.end - this.stopwatch.begin)
        // @ts-ignore
        console.log(`tab.status: complete. site took ${this.stopwatch.completeMs / 1000} seconds to load.`)
    };

    /**
     * Adds an entry to the tab webResourceAccess list.
     * @param {string} resourceName URL to the web accessible resource
     * @returns {string} generated access key
     **/
    addWebResourceAccess (resourceName) {
        // random 8-9 character key for web resource access
        const key = Math.floor(Math.random() * 10000000000).toString(16)
        this.webResourceAccess.push({ key, resourceName, time: Date.now(), wasAccessed: false })
        return key
    };

    /**
     * Access to web accessible resources needs to have the correct key passed in the URL
     * and the requests needs to happen within 1 second since the generation of the key
     * in addWebResourceAccess
     * @param {string} resourceURL web accessible resource URL
     * @returns {boolean} is access to the resource allowed
     **/
    hasWebResourceAccess (resourceURL) {
        // no record of web resource access for this tab
        if (!this.webResourceAccess.length) {
            return false
        }

        const keyMatches = webResourceKeyRegex.exec(resourceURL)
        if (!keyMatches) {
            return false
        }

        const key = keyMatches[1]
        const hasAccess = this.webResourceAccess.some(resource => {
            if (resource.key === key && !resource.wasAccessed) {
                resource.wasAccessed = true
                if ((Date.now() - resource.time) < 1000) {
                    return true
                }
            }
            return false
        })

        return hasAccess
    }

    /**
     * This method sets ampUrl. In cases where ampUrl is already set with an AMP url and the new url is
     * contained in the current ampUrl, we don't want to set ampUrl to the new url. This is because in some cases
     * simple amp urls (e.g. google.com/amp) will contain another amp url as the extacted url.
     *
     * @param {string} url - the url to set ampUrl to
     */
    setAmpUrl (url) {
        if (this.ampUrl) {
            const ampUrl = new URL(this.ampUrl)
            const newUrl = new URL(url)
            if (ampUrl.hostname.includes('google') && ampUrl.pathname.includes(newUrl.hostname)) {
                return
            }
        }

        this.ampUrl = url
    }
}

module.exports = Tab

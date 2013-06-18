#
# Copyright (c) 2012, Joyent, Inc. All rights reserved.
#
# Makefile: basic Makefile for template API service
#
# This Makefile is a template for new repos. It contains only repo-specific
# logic and uses included makefiles to supply common targets (javascriptlint,
# jsstyle, restdown, etc.), which are used by other repos as well. You may well
# need to rewrite most of this file, but you shouldn't need to touch the
# included makefiles.
#
# If you find yourself adding support for new targets that could be useful for
# other projects too, you should add these to the original versions of the
# included Makefiles (in eng.git) so that other teams can use them too.
#

#
# Tools
#
NPM       := npm
NODEUNIT	:= ./node_modules/.bin/nodeunit
NODEUNIT_ARGS   ?=

#
# Files
#
DOC_FILES	 = index.restdown
JS_FILES	:= $(shell find lib test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,doxygen,unparenthesized-return=0

include ./tools/mk/Makefile.defs

#
# Repo-specific targets
#
.PHONY: all
all:
	$(NPM) install && $(NPM) rebuild

.PHONY: test config_test ca_test ufds_test vmapi_test cnapi_test amon_test napi_test imgapi_test package_test papi_test

ca_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/ca.test.js

config_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/config.test.js

vmapi_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/vmapi.test.js

cnapi_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/cnapi.test.js

ufds_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/ufds.test.js

package_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/package.test.js

amon_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/amon.test.js

napi_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/napi.test.js

dsapi_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/dsapi.test.js

usageapi_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/usageapi.test.js

papi_test: $(NODEUNIT)
	$(NODEUNIT) $(NODEUNIT_ARGS) test/papi.test.js

test: config_test ca_test ufds_test cnapi_test napi_test package_test vmapi_test papi_test

.PHONY: setup
setup:
	$(NPM) install

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.targ
